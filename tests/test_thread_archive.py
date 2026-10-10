"""Native thread archive regressions: readonly WAL, optional schema and exact metadata."""
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
from thread_archive import DATABASE_FILE, read_threads, register_thread_routes


class ThreadArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {"STAR_OFFICE_CODEX_SQLITE_HOME": str(self.home)})
        self.env.start()
        self.path = self.home / DATABASE_FILE
        self.connections = []
        app = Flask(__name__)
        app.config["TESTING"] = True
        register_thread_routes(app)
        self.client = app.test_client()

    def tearDown(self):
        self.env.stop()
        for connection in self.connections:
            connection.close()
        self.tmp.cleanup()

    def database(self, optional=True):
        c = sqlite3.connect(self.path)
        self.connections.append(c)
        c.execute("CREATE TABLE threads(id TEXT PRIMARY KEY,title TEXT,source TEXT,cwd TEXT,"
                  "tokens_used INTEGER,created_at INTEGER,updated_at INTEGER)")
        if optional:
            for name, kind in (("name","TEXT"),("preview","TEXT"),("thread_source","TEXT"),("model","TEXT"),
                               ("archived","INTEGER"),("project_id","TEXT"),("recency_at_ms","INTEGER"),
                               ("agent_path","TEXT"),("git_branch","TEXT")):
                c.execute("ALTER TABLE threads ADD COLUMN " + name + " " + kind)
        c.commit()
        return c

    def insert(self, c, identifier, **fields):
        row = dict(id=identifier,title="任务 "+identifier,source="cli",cwd=r"C:\AI\office",
                   tokens_used=0,created_at=100,updated_at=200)
        row.update(fields)
        c.execute("INSERT INTO threads(" + ",".join(row) + ") VALUES(" + ",".join("?" for _ in row) + ")", list(row.values()))
        c.commit()

    def test_missing_does_not_create_database(self):
        r = self.client.get("/api/codex-threads")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json["available"])
        self.assertFalse(self.path.exists())
        self.assertEqual(r.headers["Cache-Control"], "no-store")

    def test_exact_tokens_sources_titles_and_optional_metadata(self):
        c = self.database()
        self.insert(c,"a",tokens_used=4777736001,name="正式名称",preview="会话摘要",thread_source="user",
                    model="gpt-6-astra",git_branch="feature/archive")
        item = read_threads()["threads"][0]
        self.assertEqual(item["tokens_used"], 4777736001)
        self.assertEqual(item["thread_source"], "user")
        self.assertEqual(item["startup_source"], "cli")
        self.assertEqual(item["title"], "正式名称")
        self.assertEqual(item["project"], "office")
        self.assertEqual(item["git_branch"], "feature/archive")
        self.assertEqual(item["created_ms"], 100000)
        self.assertNotIn("cwd", item)
        self.assertNotIn("rollout_path", item)

    def test_search_literal_filters_and_totals(self):
        c = self.database()
        self.insert(c,"a",title="100% coverage",tokens_used=12,thread_source="user",model="m",archived=1)
        self.insert(c,"b",title="coverage",tokens_used=30,thread_source="subagent",model="other",archived=0)
        r = read_threads(query="%",source="user",model="m",project="office",archived="1")
        self.assertEqual([t["id"] for t in r["threads"]], ["a"])
        self.assertEqual(r["summary"]["tokens_used"], 42)
        self.assertEqual(r["filtered_summary"]["tokens_used"], 12)
        self.assertEqual(read_threads(query="' OR 1=1 --")["pagination"]["total"], 0)

    def test_pagination_and_sort_use_recorded_fields(self):
        c = self.database()
        for i in range(23):
            self.insert(c,str(i),tokens_used=i,created_at=100+i,updated_at=200+i,
                        recency_at_ms=900000 if i==0 else 0)
        self.assertEqual(read_threads()["threads"][0]["id"], "0")
        self.assertEqual(read_threads(sort="tokens")["threads"][0]["id"], "22")
        self.assertEqual(read_threads(sort="created")["threads"][0]["id"], "22")
        r = read_threads(sort="tokens",offset=20)
        self.assertEqual(len(r["threads"]), 3)
        self.assertEqual(r["pagination"]["total"], 23)

    def test_optional_columns_and_unknown_source_do_not_hide_threads(self):
        c = self.database(optional=False)
        self.insert(c,"old",source='{"custom":"automation"}',tokens_used=10)
        r = read_threads()
        self.assertEqual(r["threads"][0]["startup_source"], "custom.automation")
        self.assertEqual(r["threads"][0]["child_count"], 0)
        self.assertEqual(r["threads"][0]["thread_source"], "")
        self.assertEqual(r["pagination"]["total"], 1)

    def test_projects_and_agent_relationships(self):
        c = self.database()
        c.executescript("CREATE TABLE projects(id TEXT,name TEXT); INSERT INTO projects VALUES('p','像素办公室');"
                        "CREATE TABLE thread_spawn_edges(parent_thread_id TEXT,child_thread_id TEXT);")
        self.insert(c,"root",project_id="p",thread_source="user")
        self.insert(c,"child",project_id="p",thread_source="subagent",agent_path="/root/a",
                    source=json.dumps({"subagent":{"thread_spawn":{"parent_thread_id":"root"}}}))
        c.execute("INSERT INTO thread_spawn_edges VALUES('root','child')")
        c.commit()
        items = {t["id"]:t for t in read_threads(project="像素办公室")["threads"]}
        self.assertEqual(items["root"]["child_count"], 1)
        self.assertEqual(items["child"]["parent_id"], "root")
        self.assertEqual(items["child"]["agent_path"], "/root/a")
        self.assertEqual(items["child"]["startup_source"], "subagent.thread_spawn")

    def test_guardian_and_future_thread_source_values_remain_visible(self):
        c = self.database()
        self.insert(c,"review",thread_source="guardian_review",source='{"subagent":{"other":"guardian"}}')
        self.insert(c,"future",thread_source="new_feature",source="exec")
        items = {t["id"]:t for t in read_threads()["threads"]}
        self.assertEqual(items["review"]["startup_source"], "subagent.guardian")
        self.assertEqual(read_threads(source="new_feature")["threads"][0]["thread_source"], "new_feature")

    def test_parent_relationship_falls_back_to_source_json(self):
        c = self.database()
        self.insert(c,"child",source=json.dumps({"subagent":{"thread_spawn":{"parent_thread_id":"parent"}}}))
        self.assertEqual(read_threads()["threads"][0]["parent_id"], "parent")

    def test_bounds_sensitive_text_and_no_conversation_access(self):
        c = self.database()
        self.insert(c,"large",title="x"*400000,preview="sk-"+"a"*30+" "+("z"*400000))
        r = read_threads()
        self.assertLessEqual(len(r["threads"][0]["title"]),240)
        self.assertLessEqual(len(r["threads"][0]["preview"]),3000)
        self.assertIn("[密钥]", r["threads"][0]["preview"])
        self.assertEqual(set(p.name for p in self.home.iterdir()),{DATABASE_FILE})

    def test_live_wal_visible_without_writes(self):
        c = self.database()
        c.execute("PRAGMA journal_mode=WAL")
        self.insert(c,"a",tokens_used=1)
        self.assertEqual(read_threads()["summary"]["tokens_used"], 1)
        self.insert(c,"b",tokens_used=2)
        before = {p.name:p.read_bytes() for p in self.home.iterdir() if p.suffix in {".sqlite","-wal"}}
        self.assertEqual(read_threads()["summary"]["tokens_used"], 3)
        for name,content in before.items():
            self.assertEqual((self.home/name).read_bytes(),content)
        self.assertEqual(c.execute("SELECT count(*) FROM threads").fetchone()[0],2)

    def test_invalid_filters_and_methods(self):
        for query in ("offset=-1","offset=x","offset=1000001","archived=yes","sort=drop","query="+"x"*201):
            self.assertEqual(self.client.get("/api/codex-threads?"+query).status_code,400)
        self.assertEqual(self.client.post("/api/codex-threads").status_code,405)

    def test_incompatible_schema_and_corruption_are_service_errors(self):
        c = sqlite3.connect(self.path)
        c.execute("CREATE TABLE threads(id TEXT)")
        c.commit()
        c.close()
        self.assertEqual(self.client.get("/api/codex-threads").status_code,503)
        self.path.write_bytes(b"not sqlite")
        self.assertEqual(self.client.get("/api/codex-threads").status_code,503)


if __name__ == "__main__":
    unittest.main()
