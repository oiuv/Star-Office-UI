"""Behavior tests: python -B -m unittest discover -s tests -v."""
from __future__ import annotations
import base64
import concurrent.futures
import importlib.util
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
from pathlib import Path
from contextlib import redirect_stdout
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from event_store import EventStore, period_bounds, _enable_wal
from hook_events import HOOKS, normalize_hook
from activity_service import apply_hook
from image_client import generate_image, validate_base_url
import store_utils

def hook(name, session="session-one", **fields):
    return {"hook_event_name": name, "session_id": session, "turn_id": "turn-one", **fields}

class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = EventStore(Path(self.tmp.name) / "events.sqlite3")
        self.state = Path(self.tmp.name) / "state.json"
        self.base = time.time() - 120
    def tearDown(self):
        self.tmp.cleanup()
    def send(self, name, offset=0, **fields):
        return apply_hook(hook(name, occurred_at=self.base+offset, **fields), self.store, self.state)
    def stats(self, since=0, until=None):
        return self.store.stats(since, until or time.time())

    def test_all_twelve_events_supported(self):
        for i, name in enumerate(HOOKS):
            normalized = normalize_hook(hook(name, session=f"s-{i}"))
            self.assertIn(normalized["state"], ("idle","writing","researching","executing","syncing","error"))
    def test_tools_map_to_animation_states(self):
        self.assertEqual(normalize_hook(hook("PreToolUse", tool_name="apply_patch"))["state"], "writing")
        self.assertEqual(normalize_hook(hook("PreToolUse", tool_name="mcp__web__search"))["state"], "researching")
        self.assertEqual(normalize_hook(hook("PreToolUse", tool_name="Bash"))["state"], "executing")
    def test_prompt_and_tool_output_are_not_retained(self):
        e=normalize_hook(hook("PostToolUse", prompt="SECRET_PROMPT", cwd="SECRET_PATH", tool_input={"command":"SECRET_COMMAND"}, tool_response={"stdout":"SECRET_OUTPUT"}))
        self.store.record(e)
        self.assertNotIn("SECRET_", json.dumps(self.store.events(0,time.time())))
    def test_explicit_tool_error(self):
        self.send("PostToolUse", tool_name="Bash", tool_response={"exit_code":2})
        self.assertEqual(self.store.main_state()["state"],"error")
        self.assertEqual(self.stats()["overview"]["tool_errors"],1)
        self.assertEqual(self.stats()["game"]["xp"],0)
    def test_unknown_event_rejected(self):
        with self.assertRaises(ValueError): normalize_hook(hook("NotAHook"))
    def test_missing_session_rejected(self):
        with self.assertRaises(ValueError): normalize_hook({"hook_event_name":"Stop"})
    def test_duplicate_tool_replay_not_counted_twice(self):
        e=normalize_hook(hook("PostToolUse",tool_use_id="tool-one"))
        self.assertFalse(self.store.record(e)["duplicate"])
        self.assertTrue(self.store.record(e)["duplicate"])
        self.assertEqual(self.stats()["overview"]["events"],1)
        self.assertEqual(self.stats()["game"]["xp"],2)
    def test_stop_then_async_post_keeps_idle(self):
        self.send("PreToolUse",0,tool_name="Bash",tool_use_id="tool-one")
        self.send("Stop",10)
        result=self.send("PostToolUse",20,tool_name="Bash",tool_use_id="tool-one")
        self.assertFalse(result["applied"])
        self.assertEqual(self.store.main_state()["state"],"idle")
        self.assertEqual(json.loads(self.state.read_text(encoding="utf-8"))["state"],"idle")
        self.assertEqual(self.stats()["overview"]["tools"],1)
    def test_new_turn_can_resume_after_stop(self):
        self.send("Stop",0)
        self.send("UserPromptSubmit",10,turn_id="turn-two")
        self.send("PreToolUse",20,turn_id="turn-two",tool_name="apply_patch")
        self.assertEqual(self.store.main_state()["state"],"writing")
    def test_out_of_order_event_does_not_regress(self):
        self.send("UserPromptSubmit",20,turn_id="turn-two")
        result=self.send("PreToolUse",10,tool_name="Bash")
        self.assertFalse(result["applied"])
        self.assertEqual(self.store.main_state()["state"],"researching")
    def test_subagent_has_independent_actor(self):
        self.send("PreToolUse",0,tool_name="apply_patch")
        self.send("SubagentStart",10,agent_id="child",agent_type="research")
        self.send("SubagentStop",20,agent_id="child")
        self.assertEqual(self.store.main_state()["state"],"writing")
        self.assertEqual(len(self.store.actors()),2)
    def test_one_session_ending_does_not_idle_another(self):
        self.send("PreToolUse",0,tool_name="apply_patch",session_id="busy")
        self.send("Stop",10,session_id="other")
        self.assertEqual(self.store.main_state()["state"],"writing")
    def test_compaction_restores_previous_state(self):
        self.send("PreToolUse",0,tool_name="apply_patch")
        self.send("PreCompact",10)
        self.send("PostCompact",20)
        self.assertEqual(self.store.main_state()["state"],"writing")
        self.send("SessionStart",21,source="compact")
        self.assertEqual(self.store.main_state()["state"],"writing")
    def test_heartbeat_counts_without_rewards(self):
        self.store.record_state("writing","working")
        self.store.record_state("writing","working")
        stats=self.stats()
        self.assertEqual(stats["states"]["writing"]["count"],2)
        self.assertEqual(stats["overview"]["heartbeats"],1)
        self.assertEqual(stats["overview"]["transitions"],1)
        self.assertEqual(stats["game"]["xp"],0)
    def test_repeated_stop_counts_once_as_completed_turn(self):
        self.send("Stop",0)
        self.send("Stop",1)
        stats=self.stats()
        self.assertEqual(stats["hooks"]["Stop"],2)
        self.assertEqual(stats["overview"]["turns"],1)
        self.assertEqual(stats["game"]["xp"],20)
    def test_tool_duration_correlated_by_id(self):
        self.send("PreToolUse",0,tool_use_id="tool-one",tool_name="Bash")
        self.send("PostToolUse",7,tool_use_id="tool-one",tool_name="Bash")
        stats=self.stats()
        self.assertEqual(stats["overview"]["average_tool_seconds"],7)
        self.assertEqual(stats["overview"]["measured_tools"],1)
    def test_state_duration_range_clipping_and_ttl(self):
        self.store.record_state("writing","work",occurred_at=1000)
        stats=self.stats(1100,1400)
        self.assertEqual(stats["states"]["writing"]["seconds"],200)
    def test_subagent_duration_stops_on_parent_interrupt(self):
        self.send("SubagentStart",0,agent_id="child")
        self.send("Interrupt",10)
        stats=self.stats(self.base,self.base+100)
        self.assertEqual(stats["states"]["executing"]["seconds"],10)
        child=next(a for a in self.store.actors() if a["is_subagent"])
        self.assertFalse(child["online"])
    def test_data_survives_store_restart(self):
        self.send("Stop")
        reopened=EventStore(self.store.path)
        self.assertEqual(reopened.stats(0,time.time())["game"]["xp"],20)
    def test_concurrent_writers_keep_all_events(self):
        def write(i):
            self.store.record_state("executing",str(i),actor_id=f"actor-{i}")
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(write,range(32)))
        self.assertEqual(self.stats()["overview"]["events"],32)
    def test_independent_stores_can_initialize_concurrently(self):
        def write(i):
            EventStore(self.store.path).record_state("executing", str(i), actor_id=f"independent-{i}")
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(write, range(32)))
        self.assertEqual(self.stats()["overview"]["events"], 32)

    def test_journal_initialization_retries_transient_lock(self):
        class BusyJournal:
            reads = 0
            changes = 0
            def execute(self, sql):
                if sql == "PRAGMA journal_mode":
                    self.reads += 1
                    if self.reads <= 2:
                        raise sqlite3.OperationalError("database is locked")
                else:
                    self.changes += 1
                return self
            def fetchone(self):
                return ("delete",)
        db = BusyJournal()
        _enable_wal(db)
        self.assertEqual(db.reads, 3)
        self.assertEqual(db.changes, 1)

    def test_journal_initialization_does_not_hide_other_errors(self):
        class BrokenJournal:
            def execute(self, sql):
                raise sqlite3.OperationalError("disk I/O error")
        with self.assertRaisesRegex(sqlite3.OperationalError, "disk I/O"):
            _enable_wal(BrokenJournal())

    def test_invalid_period(self):
        with self.assertRaises(ValueError): period_bounds("tomorrow")

class AppTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Import the actual Flask application while redirecting bootstrap writes.
        with patch.dict(os.environ,{"STAR_OFFICE_ENV":"development","FLASK_ENV":"development"}), patch("store_utils._save_json"):
            spec=importlib.util.spec_from_file_location("star_office_test_app",ROOT/"backend/app.py")
            cls.module=importlib.util.module_from_spec(spec)
            sys.modules[spec.name]=cls.module
            spec.loader.exec_module(cls.module)
        cls.module._save_json=store_utils._save_json
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.app=self.module
        directory=Path(self.tmp.name)
        self.app.STATE_FILE=str(directory/"state.json")
        self.app.AGENTS_STATE_FILE=str(directory/"agents.json")
        self.app.JOIN_KEYS_FILE=str(directory/"keys.json")
        self.app.RUNTIME_CONFIG_FILE=str(directory/"config.json")
        self.app.event_store=EventStore(directory/"events.sqlite3")
        self.app.app.config.update(TESTING=True,SECRET_KEY="test-session-key")
        self.client=self.app.app.test_client()
        self.env=patch.dict(os.environ,{"STAR_OFFICE_HOOK_TOKEN":""})
        self.env.start()
    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()
    def unlock(self):
        with self.client.session_transaction() as session: session["asset_editor_authed"]=True

    def test_local_hook_and_stats_and_page(self):
        self.assertEqual(self.client.post("/hooks/codex",json=hook("UserPromptSubmit")).status_code,200)
        self.assertEqual(self.client.get("/status").json["state"],"researching")
        stats=self.client.get("/api/stats").json
        self.assertTrue(stats["ok"]); self.assertEqual(stats["overview"]["events"],1)
        self.assertEqual(self.client.get("/stats").status_code,200)
    def test_remote_hook_requires_token(self):
        response=self.client.post("/hooks/codex",json=hook("Stop"),environ_overrides={"REMOTE_ADDR":"192.0.2.1"})
        self.assertEqual(response.status_code,403)
        with patch.dict(os.environ,{"STAR_OFFICE_HOOK_TOKEN":"fixture-token"}):
            self.assertEqual(self.client.post("/hooks/codex",json=hook("Stop")).status_code,401)
            self.assertEqual(self.client.post("/hooks/codex",json=hook("Stop"),headers={"Authorization":"Bearer fixture-token"}).status_code,200)
    def test_invalid_event_does_not_change_counts(self):
        self.assertEqual(self.client.post("/hooks/codex",json=hook("Invalid")).status_code,400)
        self.assertEqual(self.client.get("/api/stats").json["overview"]["events"],0)
    def test_state_api_and_validation(self):
        self.assertEqual(self.client.post("/set_state",json={"state":"writing","detail":"work"}).status_code,200)
        self.assertEqual(self.client.get("/api/stats").json["states"]["writing"]["count"],1)
        self.assertEqual(self.client.post("/set_state",json={"state":[]}).status_code,400)
        self.assertEqual(self.client.post("/set_state",json={"detail":{}}).status_code,400)
    def test_stats_filters_validate(self):
        self.assertEqual(self.client.get("/api/stats?period=invalid").status_code,400)
        self.assertEqual(self.client.get("/api/events?limit=100000").status_code,400)
        self.assertEqual(self.client.get("/api/events?state=invalid").status_code,400)
    def test_agents_do_not_leak_join_key(self):
        self.app.save_agents_state([{"agentId":"guest","name":"Guest","isMain":False,"joinKey":"SECRET_KEY","authStatus":"approved"}])
        self.assertNotIn("SECRET_KEY",self.client.get("/agents").get_data(as_text=True))
    def test_subagents_visible_without_overwriting_main(self):
        self.client.post("/hooks/codex",json=hook("PreToolUse",tool_name="apply_patch"))
        self.client.post("/hooks/codex",json=hook("SubagentStart",agent_id="child"))
        self.assertEqual(self.client.get("/status").json["state"],"writing")
        self.assertTrue(any(a.get("source")=="codex" for a in self.client.get("/agents").json))
    def test_manual_state_can_override_hooks(self):
        self.client.post("/hooks/codex",json=hook("PreToolUse",tool_name="Bash"))
        self.client.post("/set_state",json={"state":"idle","detail":"manual"})
        self.assertEqual(self.client.get("/status").json["detail"],"manual")
    def test_image_config_auth_and_key_masking(self):
        self.assertEqual(self.client.get("/config/ai").status_code,401)
        self.unlock()
        response=self.client.post("/config/ai",json={"api_key":"fixture-secret","base_url":"http://localhost:9999/v1","model":"custom-image","image_mode":"generate"})
        self.assertEqual(response.status_code,200)
        config=self.client.get("/config/ai").json
        self.assertEqual(config["base_url"],"http://localhost:9999/v1")
        self.assertEqual(config["model"],"custom-image")
        self.assertNotIn("fixture-secret",json.dumps(config))
        self.client.post("/config/ai",json={"api_key":"","base_url":"http://localhost:9998/v1"})
        self.assertEqual(store_utils.load_runtime_config(self.app.RUNTIME_CONFIG_FILE)["api_key"],"fixture-secret")
    def test_removed_provider_endpoint_is_not_registered(self):
        self.unlock()
        self.assertEqual(self.client.get("/config/gemini").status_code, 404)
        self.assertEqual(self.client.post("/config/gemini", json={"api_key": "fixture-key"}).status_code, 404)
        config = self.client.get("/config/ai").json
        self.assertEqual(set(config), {"ok", "provider", "has_api_key", "api_key_masked", "base_url", "model", "image_mode"})
        self.assertEqual(config["provider"], "openai")
    def test_image_config_rejects_unsupported_fields(self):
        self.unlock()
        response = self.client.post("/config/ai", json={"gemini_api_key": "old-key"})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Path(self.app.RUNTIME_CONFIG_FILE).exists())
    def test_short_key_never_echoed(self):
        self.unlock()
        self.client.post("/config/ai",json={"api_key":"abcd"})
        self.assertEqual(self.client.get("/config/ai").json["api_key_masked"],"****")
    def test_bad_base_url_and_model(self):
        self.unlock()
        self.assertEqual(self.client.post("/config/ai",json={"base_url":"file:///etc/passwd"}).status_code,400)
        self.assertEqual(self.client.post("/config/ai",json={"base_url":"https://user:pass@example.com/v1"}).status_code,400)
        self.assertEqual(self.client.post("/config/ai",json={"model":""}).status_code,400)
    def test_generation_replaces_image_through_transport(self):
        from PIL import Image
        self.unlock()
        image=io.BytesIO(); Image.new("RGB",(8,8),(80,120,30)).save(image,"PNG")
        target=Path(self.tmp.name)/"result.webp"
        with patch.object(self.app,"generate_image",return_value=image.getvalue()) as transport:
            self.app._generate_rpg_background_to_webp(str(target),custom_prompt="forest")
        with Image.open(target) as result:
            self.assertEqual(result.size,(1280,720))
        self.assertEqual(transport.call_args[0][2],self.app.ROOM_REFERENCE_IMAGE)

class ImageTransportTests(unittest.TestCase):
    def setUp(self):
        self.calls=[]
        self.config={"api_key":"fixture-key","base_url":"https://image.example/v1/","model":"custom-image","image_mode":"generate"}
        self.result={"data":[{"b64_json":base64.b64encode(b"image-bytes").decode()}]}
        outer=self
        class Opener:
            def open(self,request,timeout):
                outer.calls.append(request)
                return io.BytesIO(json.dumps(outer.result).encode())
        self.opener=Opener()
    def test_generation_uses_custom_address_and_model(self):
        self.assertEqual(generate_image(self.config,"prompt",opener=self.opener),b"image-bytes")
        request=self.calls[0]
        self.assertEqual(request.full_url,"https://image.example/v1/images/generations")
        self.assertEqual(json.loads(request.data)["model"],"custom-image")
        self.assertEqual(request.get_header("Authorization"),"Bearer fixture-key")
    def test_custom_model_omits_gpt_specific_parameters(self):
        generate_image(self.config,"prompt",opener=self.opener)
        fields=json.loads(self.calls[0].data)
        self.assertNotIn("quality",fields)
        self.assertNotIn("size",fields)
    def test_edit_sends_reference_multipart(self):
        with tempfile.TemporaryDirectory() as directory:
            reference=Path(directory)/"reference.png"; reference.write_bytes(b"reference-image")
            self.config["image_mode"]="edit"
            generate_image(self.config,"keep layout",reference,opener=self.opener)
        self.assertEqual(self.calls[0].full_url,"https://image.example/v1/images/edits")
        self.assertIn(b'name="image"',self.calls[0].data)
        self.assertIn(b"reference-image",self.calls[0].data)
    def test_url_result_download_does_not_send_api_key(self):
        calls=self.calls
        class Opener:
            def open(self,request,timeout):
                calls.append(request)
                if len(calls)==1: return io.BytesIO(json.dumps({"data":[{"url":"https://cdn.example/image.png"}]}).encode())
                return io.BytesIO(b"downloaded-image")
        self.assertEqual(generate_image(self.config,"prompt",opener=Opener()),b"downloaded-image")
        self.assertIsNone(calls[1].get_header("Authorization"))
    def test_provider_error_redacts_key(self):
        class Opener:
            def open(self,request,timeout):
                raise urllib.error.HTTPError(request.full_url,400,"bad",{},io.BytesIO(b'{"error":{"message":"fixture-key invalid"}}'))
        with self.assertRaisesRegex(RuntimeError,r"\[redacted\]") as error:
            generate_image(self.config,"prompt",opener=Opener())
        self.assertNotIn("fixture-key",str(error.exception))
    def test_invalid_image_response(self):
        self.result={"data":[]}
        with self.assertRaisesRegex(RuntimeError,"no image"):
            generate_image(self.config,"prompt",opener=self.opener)
    def test_edit_does_not_silently_drop_reference(self):
        self.config["image_mode"]="edit"
        with self.assertRaisesRegex(RuntimeError,"Reference image missing"):
            generate_image(self.config,"prompt",opener=self.opener)
    def test_config_ignores_unsupported_provider_fields(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            path = Path(directory) / "runtime.json"
            path.write_text(json.dumps({"gemini_api_key": "old-key", "gemini_model": "old-model"}))
            config = store_utils.load_runtime_config(str(path))
            self.assertEqual(config, {"api_key": "", "base_url": "https://api.openai.com/v1", "model": "gpt-image-2", "image_mode": "edit"})
            store_utils.save_runtime_config(str(path), {"api_key": "new-key", "gemini_api_key": "ignored-key"})
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(set(saved), {"api_key", "base_url", "model", "image_mode"})
            self.assertEqual(saved["api_key"], "new-key")
    def test_url_validation(self):
        for value in ("ftp://example.com","https://example.com/v1?secret=x","https://example.com/#key"):
            with self.assertRaises(ValueError): validate_base_url(value)

class ScriptTests(unittest.TestCase):
    def test_hook_script_is_quiet_and_fail_open(self):
        result=subprocess.run([sys.executable,"-B",str(ROOT/"codex_hook.py")],input=b"not-json",capture_output=True,timeout=4)
        self.assertEqual(result.returncode,0); self.assertEqual(json.loads(result.stdout),{}); self.assertEqual(result.stderr,b"")
    def test_hook_script_records_without_running_server(self):
        with tempfile.TemporaryDirectory() as directory:
            db=Path(directory)/"events.sqlite3"; state=Path(directory)/"state.json"
            env={**os.environ,"STAR_OFFICE_EVENTS_DB":str(db),"STAR_OFFICE_STATE_FILE":str(state),"STAR_OFFICE_URL":""}
            result=subprocess.run([sys.executable,"-B",str(ROOT/"codex_hook.py")],input=json.dumps(hook("PreToolUse",tool_name="apply_patch")).encode(),env=env,capture_output=True,timeout=4)
            self.assertEqual(result.returncode,0); self.assertEqual(json.loads(result.stdout),{})
            self.assertEqual(json.loads(state.read_text(encoding="utf-8"))["state"],"writing")
            self.assertEqual(EventStore(db).stats(0,time.time())["hooks"]["PreToolUse"],1)
    def test_config_generator_has_all_events_and_timeouts(self):
        spec=importlib.util.spec_from_file_location("hooks_config",ROOT/"scripts/codex_hooks_config.py")
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        config=module.build_config()
        self.assertEqual(set(config["hooks"]),set(HOOKS))
        self.assertEqual(config["hooks"]["SessionEnd"][0]["hooks"][0]["timeout"],3)
        self.assertTrue(config["hooks"]["PostToolUse"][0]["hooks"][0]["async"])
    def test_image_cli_uses_openai_configuration(self):
        spec = importlib.util.spec_from_file_location("image_generate_cli", ROOT / "scripts/image_generate.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            arguments = ["image_generate.py", "--prompt", "forest", "--out-dir", directory, "--mode", "generate", "--base-url", "https://relay.example/v1", "--model", "gpt-image-2", "--speed-mode", "fast"]
            output = io.StringIO()
            with patch.object(sys, "argv", arguments), patch.dict(os.environ, {"OPENAI_API_KEY": "fixture-key"}), patch.object(module, "generate_image", return_value=b"fixture-image") as transport, redirect_stdout(output):
                self.assertEqual(module.main(), 0)
            config, prompt, reference, speed = transport.call_args[0]
            self.assertEqual(config, {"api_key": "fixture-key", "model": "gpt-image-2", "base_url": "https://relay.example/v1", "image_mode": "generate"})
            self.assertEqual((prompt, reference, speed), ("forest", "", "fast"))
            target = Path(directory) / "generated_0.png"
            self.assertEqual(target.read_bytes(), b"fixture-image")
            self.assertEqual(json.loads(output.getvalue()), {"files": [str(target)]})
    def test_cli_state_records_and_aliases(self):
        with tempfile.TemporaryDirectory() as directory:
            db=Path(directory)/"events.sqlite3"; state=Path(directory)/"state.json"
            env={**os.environ,"STAR_OFFICE_EVENTS_DB":str(db),"STAR_OFFICE_STATE_FILE":str(state),"PYTHONIOENCODING":"utf-8"}
            result=subprocess.run([sys.executable,"-B",str(ROOT/"set_state.py"),"receiving","new task"],env=env,capture_output=True,timeout=4)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(state.read_text(encoding="utf-8"))["state"],"researching")
            self.assertEqual(EventStore(db).stats(0,time.time())["overview"]["state_updates"],1)

if __name__=="__main__":
    unittest.main()
