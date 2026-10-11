"""Retained global transcripts: deduplication, read-only access and refresh behavior."""
from pathlib import Path
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import claude_archive as archive

A = "11111111-1111-4111-8111-111111111111"
B = "22222222-2222-4222-8222-222222222222"


def reply(identifier="msg-1", **usage):
    return {"type": "assistant", "timestamp": "2026-10-09T10:00:00Z", "cwd": r"C:\AI\office",
            "message": {"id": identifier, "model": "model-a", "usage": usage,
                        "content": [{"type": "tool_use", "id": "tool-1", "name": "Read", "input": {"secret": "private"}},
                                    {"type": "thinking", "thinking": "PRIVATE REASONING"}]}}


class ClaudeArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(self.home)})
        self.env.start()
        archive._cache.clear()
        app = Flask(__name__)
        archive.register_claude_archive_routes(app)
        self.client = app.test_client()

    def tearDown(self):
        archive._cache.clear()
        self.env.stop()
        self.tmp.cleanup()

    def write(self, name, records, project="p"):
        path = self.home / "projects" / project / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(row) + "\n" for row in records), encoding="utf-8")
        return path

    def test_missing_directory_is_not_created(self):
        response = self.client.get("/api/claude-sessions")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json["available"])
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertFalse((self.home / "projects").exists())

    def test_stream_updates_forks_and_tools_are_deduplicated(self):
        first = reply(input_tokens=100, output_tokens=0, cache_read_input_tokens=30, cache_creation_input_tokens=5)
        final = reply(input_tokens=100, output_tokens=20, cache_read_input_tokens=30, cache_creation_input_tokens=5)
        self.write(A + ".jsonl", [first, final, first])
        self.write(B + ".jsonl", [first, final], "other-project")
        result = archive.read_claude_sessions()
        s = result["summary"]
        self.assertEqual(s["sessions"], 2)
        self.assertEqual(s["tokens"], 155)
        self.assertEqual(s["tool_calls"], 1)
        self.assertEqual(s["replies"], 1)
        self.assertEqual(s["cache_read_share"], 30 / 135)
        self.assertEqual(s["models"], [{"value": "model-a", "count": 1, "tokens": 155}])

    def test_global_projects_subagents_filters_and_no_private_payloads(self):
        user = {"type": "user", "uuid": "u1", "message": {"content": "Fix this sk-abcdefghijklmnop123456"}}
        result_user = {"type": "user", "message": {"content": [{"type": "tool_result", "content": "PRIVATE OUTPUT"}]}}
        meta = {"type": "user", "isMeta": True, "message": {"content": "PRIVATE CONTROL"}}
        self.write(A + ".jsonl", [user, user, result_user, meta, reply(input_tokens=7)])
        child = reply("child", output_tokens=4)
        child["cwd"] = "/home/test/other"
        self.write(B + "/subagents/agent-abc.jsonl", [child], "q")
        self.write("agent-old.jsonl", [{"type": "agent-name", "sessionId": A, "agentName": "worker"}, reply("old", input_tokens=2)])
        self.write("orphaned/" + A + ".jsonl", [reply("excluded", input_tokens=999)])
        self.write("other.jsonl", [reply("excluded2", input_tokens=999)])
        response = self.client.get("/api/claude-sessions?kind=subagent&project=other")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["summary"]["subagents"], 2)
        self.assertEqual(response.json["filtered_summary"]["tokens"], 4)
        self.assertEqual(response.json["sessions"][0]["parent_id"], B)
        data = self.client.get("/api/claude-sessions").json
        main = next(item for item in data["sessions"] if item["id"] == A)
        self.assertEqual(main["prompts"], 1)
        payload = json.dumps(data)
        for private in ("PRIVATE REASONING", "PRIVATE OUTPUT", "PRIVATE CONTROL", "abcdefghijklmnop123456", "C:\\\\AI", '"_messages"', '"input"'):
            self.assertNotIn(private, payload)

    def test_first_prompt_is_complete_and_sanitized_without_loading_later_messages(self):
        prompt = "评审任务\n" + "具体要求，请逐项核实。\n" * 160 + "最后一项：检查完整正文。 sk-abcdefghijklmnop123456"
        self.write(A + "/subagents/agent-review.jsonl", [
            {"type": "user", "uuid": "u1", "message": {"content": [{"type": "text", "text": prompt}]}},
            {"type": "user", "uuid": "u2", "message": {"content": "后续用户消息不进入首条正文"}},
            reply(input_tokens=1),
        ])
        item = self.client.get("/api/claude-sessions").json["sessions"][0]
        self.assertGreater(len(item["preview"]), 600)
        self.assertIn("最后一项：检查完整正文。", item["preview"])
        self.assertEqual(item["preview"].count("具体要求，请逐项核实。"), 160)
        self.assertNotIn("abcdefghijklmnop123456", item["preview"])
        self.assertNotIn("后续用户消息", item["preview"])
        self.assertLessEqual(len(item["title"]), 240)

    def test_cache_unchanged_files_then_append_replace_and_delete(self):
        path = self.write(A + ".jsonl", [reply(input_tokens=10)])
        before = path.read_bytes(), path.stat().st_mtime_ns
        with patch.object(archive, "_parse", wraps=archive._parse) as parser:
            self.assertEqual(archive.read_claude_sessions()["summary"]["tokens"], 10)
            archive.read_claude_sessions()
            self.assertEqual(parser.call_count, 1)
            self.assertEqual(before, (path.read_bytes(), path.stat().st_mtime_ns))
            with path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(reply("new", output_tokens=8)) + "\n")
            self.assertEqual(archive.read_claude_sessions()["summary"]["tokens"], 18)
            self.write(A + ".jsonl", [reply(input_tokens=1)])
            self.assertEqual(archive.read_claude_sessions()["summary"]["tokens"], 1)
            path.unlink()
            self.assertEqual(archive.read_claude_sessions()["summary"]["sessions"], 0)
            self.assertEqual(len(archive._cache), 0)

    def test_partial_line_invalid_fields_and_unknown_usage(self):
        bad = reply(input_tokens=-1, output_tokens=True, cache_read_input_tokens="10")
        synthetic = reply("synthetic", input_tokens=999)
        synthetic["message"]["model"] = "<synthetic>"
        path = self.write(A + ".jsonl", [bad, synthetic, {"type": "user", "sessionId": None, "timestamp": {}}, []])
        with path.open("a") as stream:
            stream.write('{"unfinished":')
        result = archive.read_claude_sessions()
        self.assertEqual(result["summary"]["tokens"], 0)
        self.assertEqual(result["summary"]["replies"], 1)
        self.assertEqual(result["summary"]["usage_replies"], 0)
        self.assertEqual(result["coverage"]["skipped_lines"], 2)

    def test_invalid_filters_and_pagination(self):
        for value in ("offset=-1", "offset=bad", "sort=bad", "kind=bad", "query=" + "x" * 201):
            self.assertEqual(self.client.get("/api/claude-sessions?" + value).status_code, 400)
        for index in range(21):
            self.write(f"{index:08x}-1111-4111-8111-111111111111.jsonl", [reply(str(index), input_tokens=index)])
        data = self.client.get("/api/claude-sessions?sort=tokens&offset=20").json
        self.assertEqual(len(data["sessions"]), 1)
        self.assertEqual(data["sessions"][0]["tokens"], 0)
        self.assertEqual(data["pagination"]["total"], 21)


if __name__ == "__main__":
    unittest.main()
