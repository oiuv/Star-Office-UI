"""Behavior tests for reading Codex summaries without exposing raw memory files."""
from pathlib import Path
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from memo_utils import load_recent_memos, MAX_SUMMARY_BYTES


class RecentMemoTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.directory = self.home / "memories" / "rollout_summaries"
        self.directory.mkdir(parents=True)
        self.env = patch.dict(os.environ, {"CODEX_HOME": str(self.home)})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def summary(self, name="sample.md", updated="2026-10-04T12:00:00+08:00", body=None):
        content = (f"thread_id: private-thread\nupdated_at: {updated}\n"
                   "rollout_path: C:/private/sessions/log.jsonl\n"
                   "cwd: \\\\?\\C:\\AI\\Star-Office-UI\n"
                   "# 办公室菜单更新\n\n")
        content += body or "## Task 1: 修复菜单遮挡\nOutcome: success\n"
        path = self.directory / name
        path.write_text(content, encoding="utf-8-sig")
        return path

    def test_utf8_project_tasks_and_read_only(self):
        path = self.summary(body="## Task 1: 修复菜单遮挡\nOutcome: success\n## Task 2: 验证手机布局\nOutcome: partial\n")
        before = path.read_bytes()
        entry = load_recent_memos()[0]
        self.assertEqual(entry["project"], "Star-Office-UI")
        self.assertEqual(entry["title"], "办公室菜单更新")
        self.assertEqual(entry["tasks"][1], {"title": "验证手机布局", "outcome": "partial"})
        self.assertEqual(entry["updated_at"], "2026-10-04T04:00:00+00:00")
        self.assertNotIn("private", str(entry))
        self.assertNotIn("cwd", entry)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(len(list(self.directory.iterdir())), 1)

    def test_orders_by_metadata_not_filename_or_file_mtime(self):
        old = self.summary("2099-old.md", "2026-09-01T10:00:00Z")
        new = self.summary("2000-new.md", "2026-10-04T10:00:00Z")
        os.utime(old, (1900000000, 1900000000))
        os.utime(new, (1000000000, 1000000000))
        self.assertEqual(load_recent_memos()[0]["updated_at"], "2026-10-04T10:00:00+00:00")

    def test_limit_and_three_tasks_per_summary(self):
        for day in range(1, 8):
            self.summary(f"{day}.md", f"2026-10-{day:02d}T10:00:00Z", "\n".join(f"## Task {i}: 工作 {i}\nOutcome: unknown" for i in range(1, 6)))
        entries = load_recent_memos()
        self.assertEqual(len(entries), 5)
        self.assertEqual(len(entries[0]["tasks"]), 3)
        self.assertEqual(entries[0]["updated_at"], "2026-10-07T10:00:00+00:00")

    def test_missing_empty_and_invalid_files(self):
        self.assertEqual(load_recent_memos(), [])
        self.summary("invalid-date.md", "not-a-date")
        (self.directory / "invalid-utf8.md").write_bytes(b"\xff\xfe")
        (self.directory / "oversize.md").write_bytes(b"x" * (MAX_SUMMARY_BYTES + 1))
        (self.directory / "no-heading.md").write_text("updated_at: 2026-10-04T10:00:00Z\n", encoding="utf-8")
        self.assertEqual(load_recent_memos(), [])
        with patch.dict(os.environ, {"CODEX_HOME": str(self.home / "missing")}):
            self.assertEqual(load_recent_memos(), [])
        self.summary("valid.md")
        self.assertEqual(len(load_recent_memos()), 1)

    def test_default_codex_home_and_tilde_override(self):
        with patch.dict(os.environ, {"CODEX_HOME": ""}), patch("memo_utils.Path.home", return_value=self.home):
            directory = self.home / ".codex" / "memories" / "rollout_summaries"
            directory.mkdir(parents=True)
            self.summary().rename(directory / "default.md")
            self.assertEqual(len(load_recent_memos()), 1)
        with patch.dict(os.environ, {"HOME": str(self.home), "USERPROFILE": str(self.home), "CODEX_HOME": "~/.codex"}):
            self.assertEqual(len(load_recent_memos()), 1)

    def test_code_fences_are_not_tasks_and_fallback_is_sanitized(self):
        self.summary(body="工作摘要：联系 alice@example.com，并检查 C:/private/report.txt。\n```md\n## Task 99: fake task\n```\n")
        entry = load_recent_memos()[0]
        self.assertEqual(len(entry["tasks"]), 1)
        self.assertIn("[邮箱]", entry["tasks"][0]["title"])
        self.assertIn("[路径]", entry["tasks"][0]["title"])
        self.assertNotIn("fake task", str(entry))

    def test_unreadable_file_does_not_hide_other_summaries(self):
        blocked = self.summary("blocked.md")
        self.summary("readable.md")
        real_open = Path.open
        def open_file(path, *args, **kwargs):
            if path == blocked:
                raise PermissionError("fixture")
            return real_open(path, *args, **kwargs)
        with patch.object(Path, "open", open_file):
            self.assertEqual(len(load_recent_memos()), 1)


if __name__ == "__main__":
    unittest.main()
