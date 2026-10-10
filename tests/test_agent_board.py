"""Regression tests for the native Codex board, including live WAL reads."""
from pathlib import Path
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from agent_board import DATABASE_FILE, BoardUnavailable, board_summary, read_board, register_board_routes, sqlite_home


class AgentBoardTests(unittest.TestCase):
    def setUp(self):
        self.connections = []
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {"CODEX_HOME": str(self.home), "CODEX_SQLITE_HOME": "",
                                           "STAR_OFFICE_CODEX_SQLITE_HOME": ""})
        self.env.start()
        self.path = self.home / DATABASE_FILE
        app = Flask(__name__)
        app.config["TESTING"] = True
        register_board_routes(app)
        self.client = app.test_client()

    def tearDown(self):
        self.env.stop()
        for connection in self.connections:
            connection.close()
        self.tmp.cleanup()

    def database(self, description=True):
        connection = sqlite3.connect(self.path)
        self.connections.append(connection)
        connection.executescript("""
        CREATE TABLE channels(board TEXT,name TEXT,author TEXT,PRIMARY KEY(board,name));
        CREATE TABLE posts(seq INTEGER PRIMARY KEY AUTOINCREMENT,board TEXT,id TEXT,channel TEXT,
                           root TEXT,author TEXT,timestamp INTEGER,body_search TEXT,payload TEXT);
        """)
        if description:
            connection.execute("ALTER TABLE channels ADD COLUMN description TEXT")
        connection.execute("INSERT INTO channels(board,name,author) VALUES('session-a','planning','/root')")
        connection.execute("INSERT INTO channels(board,name,author) VALUES('session-b','review','/root')")
        connection.commit()
        return connection

    def post(self, connection, identifier, text, root=None, author="/root", board="session-a", channel="planning"):
        metadata = {"message_id": identifier, "thread_id": root or identifier, "channel_name": channel,
                    "author": author, "created_at": "2026-10-10T08:00:00Z"}
        payload = json.dumps({"metadata": metadata, "text": text})
        connection.execute("INSERT INTO posts(board,id,channel,root,author,timestamp,body_search,payload) "
                           "VALUES(?,?,?,?,?,?,?,?)",
                           (board, identifier, channel, root or identifier, author, 100, text.lower(), payload))
        connection.commit()

    def test_missing_does_not_create_files(self):
        before = list(self.home.iterdir())
        response = self.client.get("/api/agent-board")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["status"], "missing")
        self.assertEqual(list(self.home.iterdir()), before)
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_native_posts_and_replies_are_read_only_and_sessions_are_isolated(self):
        with self.database() as writer:
            self.post(writer, "topic-a", "Plan the work")
            self.post(writer, "reply-a", "Review done", root="topic-a", author="/root/reviewer")
            self.post(writer, "topic-b", "Another project", board="session-b", channel="review")
        before = self.path.read_bytes()
        data = read_board(board="session-a")
        self.assertEqual(data["summary"]["messages"], 3)
        self.assertEqual(data["summary"]["agents"], 3)
        self.assertEqual(data["board_summary"]["agents"], 2)
        self.assertEqual(data["board_summary"]["messages"], 2)
        self.assertEqual(data["summary"]["threads"], 2)
        self.assertEqual(data["summary"]["replies"], 1)
        self.assertEqual(data["authors"], ["/root", "/root/reviewer"])
        self.assertEqual([post["id"] for post in data["posts"]], ["topic-a", "reply-a"])
        self.assertEqual(data["threads"][0]["reply_count"], 1)
        self.assertNotIn("Another project", str(data["posts"]))
        self.assertEqual(self.path.read_bytes(), before)

    def test_reply_search_and_author_filters_open_the_complete_discussion(self):
        with self.database() as writer:
            self.post(writer, "topic", "讨论设计")
            self.post(writer, "reply", "方案已经验证", root="topic", author="/root/tester")
            self.post(writer, "other", "无关讨论")
        data = read_board(board="session-a", query="已经验证", author="/root/tester")
        self.assertEqual([topic["id"] for topic in data["threads"]], ["topic"])
        self.assertEqual([post["id"] for post in data["posts"]], ["topic", "reply"])
        self.assertEqual(read_board(board="session-a", query="already")["threads"], [])

    def test_search_escapes_sql_wildcards_and_parameters(self):
        with self.database() as writer:
            self.post(writer, "one", "100%_complete")
            self.post(writer, "two", "100XXcomplete")
        self.assertEqual([x["id"] for x in read_board(board="session-a", query="%_")["threads"]], ["one"])
        self.assertEqual(read_board(board="session-a", query="' OR 1=1 --")["threads"], [])

    def test_topic_and_reply_pagination_keep_the_root(self):
        with self.database() as writer:
            for i in range(22):
                self.post(writer, f"topic-{i}", f"Topic {i}")
            for i in range(23):
                self.post(writer, f"reply-{i}", f"Reply {i}", root="topic-0", author="/root/helper")
        first = read_board(board="session-a", thread="topic-0")
        self.assertTrue(first["pagination"]["has_more"])
        self.assertTrue(first["reply_pagination"]["has_more"])
        self.assertEqual(len(first["posts"]), 21)
        later = read_board(board="session-a", thread="topic-0", offset=20, reply_offset=20)
        self.assertEqual(len(later["threads"]), 2)
        self.assertEqual([x["id"] for x in later["posts"]], ["topic-0", "reply-20", "reply-21", "reply-22"])
        self.assertFalse(later["reply_pagination"]["has_more"])

    def test_reads_uncheckpointed_wal_without_immutable_mode(self):
        writer = self.database()
        try:
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("PRAGMA wal_autocheckpoint=0")
            self.post(writer, "live", "Live update")
            self.assertTrue(Path(str(self.path) + "-wal").exists())
            self.assertEqual(read_board(board="session-a")["posts"][0]["id"], "live")
            self.post(writer, "new", "Second live update")
            self.assertEqual(read_board(board="session-a")["board_summary"]["messages"], 2)
        finally:
            writer.close()

    def test_titles_are_optional_and_only_project_basename_is_exposed(self):
        with self.database() as writer:
            self.post(writer, "topic", "Hello")
        with sqlite3.connect(self.home / "state_5.sqlite") as state:
            self.connections.append(state)
            state.execute("CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT)")
            state.execute("INSERT INTO threads VALUES(?,?,?)", ("session-a", "实现留言板", "C:/private/Star-Office-UI"))
        data = read_board(board="session-a")
        board = next(board for board in data["boards"] if board["id"] == "session-a")
        self.assertEqual(board["project"], "Star-Office-UI")
        self.assertEqual(board["title"], "实现留言板")
        self.assertNotIn("private", str(data))
        self.assertNotIn("cwd", board)

    def test_body_preserves_fences_and_redacts_common_sensitive_data(self):
        with self.database() as writer:
            self.post(writer, "topic", "```python\nprint('<img src=x>')\n```\nContact alice@example.com sk-" + "a" * 24)
        body = read_board(board="session-a")["posts"][0]["text"]
        self.assertIn("```python", body)
        self.assertIn("<img src=x>", body)
        self.assertNotIn("alice@", body)
        self.assertNotIn("sk-", body)

    def test_corrupt_post_does_not_hide_other_posts_and_older_channels_work(self):
        with self.database(description=False) as writer:
            self.post(writer, "good", "Good post")
            self.post(writer, "bad", "Bad post")
            writer.execute("UPDATE posts SET payload='broken' WHERE id='bad'")
        data = read_board(board="session-a")
        self.assertTrue(data["posts"][0]["unreadable"])
        self.assertEqual(len(data["threads"]), 2)
        self.assertEqual(data["channels"][0]["description"], "")

    def test_config_and_explicit_directory_priority(self):
        configured = self.home / "configured"
        (self.home / "config.toml").write_text('sqlite_home = "' + configured.as_posix() + '"', encoding="utf-8")
        with patch.dict(os.environ, {"CODEX_SQLITE_HOME": str(self.home / "env")}):
            self.assertEqual(sqlite_home(), configured)
            with patch.dict(os.environ, {"STAR_OFFICE_CODEX_SQLITE_HOME": str(self.home / "office")}):
                self.assertEqual(sqlite_home(), self.home / "office")
        (self.home / "config.toml").unlink()
        with patch.dict(os.environ, {"CODEX_SQLITE_HOME": str(self.home / "env")}):
            self.assertEqual(sqlite_home(), self.home / "env")

    def test_schema_errors_do_not_break_activity_summary(self):
        self.path.write_bytes(b"not sqlite")
        self.assertEqual(self.client.get("/api/agent-board").status_code, 503)
        self.assertEqual(board_summary()["status"], "unavailable")
        self.assertNotIn(str(self.path), str(self.client.get("/api/agent-board").json))

    def test_filters_are_bounded_unknown_sessions_are_not_silently_replaced(self):
        with self.database() as writer:
            self.post(writer, "topic", "Hello")
        for query in ("offset=-1", "reply_offset=nope", "query=" + "a" * 201):
            self.assertEqual(self.client.get("/api/agent-board?" + query).status_code, 400)
        self.assertEqual(self.client.get("/api/agent-board?board=unknown").status_code, 404)
        self.assertEqual(self.client.get("/api/agent-board?board=session-a&channel=wrong").status_code, 404)
        self.assertEqual(self.client.post("/api/agent-board", json={"text": "write"}).status_code, 405)
        summary = self.client.get("/api/agent-board?summary=1").json
        self.assertEqual(summary["summary"]["messages"], 1)
        self.assertNotIn("posts", summary)


if __name__ == "__main__":
    unittest.main()
