"""Claude Code native payloads, provider isolation and observer integration."""
from __future__ import annotations
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import test_activity as existing
from activity_service import apply_hook
from event_store import EventStore
from hook_events import CLAUDE_HOOKS, CLAUDE_OBSERVER_HOOKS, CLAUDE_ASYNC_HOOKS, HOOKS, normalize_hook
from hook_observer import forwardable_event

ROOT = Path(__file__).resolve().parent.parent

def native(name, **extra):
    return {"hook_event_name": name, "session_id": "shared-session", "prompt_id": "prompt-1", **extra}

class ClaudeLedgerTests(unittest.TestCase):
    setUp = existing.LedgerTests.setUp
    tearDown = existing.LedgerTests.tearDown
    stats = existing.LedgerTests.stats

    def send(self, name, offset=0, provider="claude_code", **extra):
        return apply_hook(native(name, occurred_at=self.base+offset, **extra),
                          self.store, self.state, provider=provider)

    def test_all_native_events_have_readable_chinese_log_descriptions(self):
        for name in CLAUDE_HOOKS:
            with self.subTest(event=name):
                event = normalize_hook(native(name), "claude_code")
                self.assertRegex(event["detail"], r"[\u4e00-\u9fff]")
                self.assertFalse(event["detail"].startswith("已记录 "))
                self.assertEqual(event["metadata"]["original_event_name"], name)
        failure = normalize_hook(native("StopFailure", error="SECRET_ERROR"), "claude_code")
        self.assertIn("API", failure["detail"])
        self.assertEqual(failure["outcome"], "error")
        self.assertNotIn("SECRET_ERROR", failure["detail"])
        completing = normalize_hook(native("TaskCompleted"), "claude_code")
        self.assertIn("检查", completing["detail"])
        self.assertTrue(completing["metadata"]["observe_only"])

    def test_native_events_and_source_are_valid(self):
        for name in CLAUDE_HOOKS:
            event = normalize_hook(native(name, source="resume"), "claude_code")
            self.assertEqual(event["source"], "claude_code")
            self.assertEqual(event["metadata"]["source"], "resume")
            self.assertEqual(event["metadata"]["original_event_name"], name)
            self.assertEqual(event["turn_id"], "prompt-1")
        with self.assertRaises(ValueError):
            normalize_hook(native("Interrupt"), "claude_code")
        with self.assertRaises(ValueError):
            normalize_hook(native("Stop"), "opencode")

    def test_failed_tool_is_counted_without_xp_or_success_badge(self):
        self.send("PreToolUse", tool_use_id="tool-1", tool_name="Bash")
        self.send("PostToolUseFailure", 7, tool_use_id="tool-1", tool_name="Bash", error="SECRET_ERROR")
        self.send("PostToolUseFailure", 8, tool_use_id="tool-1", tool_name="Bash")
        stats=self.stats()
        self.assertEqual(stats["overview"]["tool_errors"], 1)
        self.assertEqual(stats["overview"]["average_tool_seconds"], 7)
        self.assertEqual(stats["game"]["xp"], 0)
        self.assertFalse(next(b for b in stats["game"]["badges"] if b["id"]=="first_tool_success")["earned"])
        self.assertNotIn("SECRET_ERROR", json.dumps(self.store.events(0,time.time())))
        self.assertEqual(self.store.main_state()["state"], "error")

    def test_claude_exclusive_failure_cannot_unlock_recovery_but_shared_permission_can(self):
        self.send("PostToolUseFailure", 0, tool_use_id="failed")
        self.send("PostToolUse", 1, tool_use_id="success")
        discoveries={b.get("id") for b in self.stats()["game"]["exploration"] if b["earned"]}
        self.assertNotIn("second_wind", discoveries)
        self.send("PermissionRequest", 2, tool_use_id="permitted")
        self.send("PostToolUse", 3, tool_use_id="permitted")
        discoveries={b.get("id") for b in self.stats()["game"]["exploration"] if b["earned"]}
        self.assertIn("second_wind", discoveries)

    def test_response_failure_never_earns_turn_rewards(self):
        self.send("UserPromptSubmit")
        self.send("StopFailure", 1, error="billing_error")
        stats=self.stats()
        self.assertEqual(stats["overview"]["turns"], 0)
        self.assertEqual(stats["game"]["xp"], 0)
        self.assertFalse(next(b for b in stats["game"]["badges"] if b["id"]=="first_turn")["earned"])
        self.assertEqual(self.store.main_state()["state"], "error")

    def test_replays_and_late_results_preserve_completed_turn(self):
        self.send("UserPromptSubmit")
        self.send("PreToolUse", 1, tool_use_id="tool-1", tool_name="Edit")
        self.send("Stop", 2)
        self.assertTrue(self.send("Stop", 3)["duplicate"])
        self.assertFalse(self.send("PostToolUse", 4, tool_use_id="tool-1")["applied"])
        self.assertTrue(self.send("PostToolUse", 5, tool_use_id="tool-1")["duplicate"])
        self.assertEqual(self.store.main_state()["state"], "idle")
        self.assertEqual(self.stats()["game"]["xp"], 22)
        self.send("UserPromptSubmit", 6, prompt_id="prompt-2")
        self.send("PreToolUse", 7, prompt_id="prompt-2", tool_name="Edit", tool_use_id="tool-2")
        self.assertEqual(self.store.main_state()["state"], "writing")

    def test_shared_native_ids_do_not_merge_providers_or_close_other_children(self):
        for provider in ("codex", "claude_code"):
            self.send("SessionStart", provider=provider)
            self.send("SubagentStart", 1, provider=provider, agent_id="child")
            self.send("PreToolUse", 2, provider=provider, agent_id="child", tool_use_id="tool-1", tool_name="Bash")
        self.send("SessionEnd", 5, provider="codex")
        actors=self.store.actors()
        claude_child=next(a for a in actors if a["source"]=="claude_code" and a["is_subagent"])
        codex_child=next(a for a in actors if a["source"]=="codex" and a["is_subagent"])
        self.assertTrue(claude_child["online"])
        self.assertFalse(codex_child["online"])
        stats=self.stats(self.base, self.base+10)
        self.assertEqual(stats["overview"]["sessions"], 2)
        self.assertEqual(stats["states"]["executing"]["seconds"], 13)
        self.assertEqual(len(actors), 4)

    def test_all_33_native_events_are_counted_and_raw_names_filterable(self):
        self.assertEqual(len(CLAUDE_HOOKS),33)
        self.assertEqual(len(CLAUDE_OBSERVER_HOOKS),32)
        for i,name in enumerate(CLAUDE_HOOKS):
            self.send(name,i,tool_use_id="tool-"+name,agent_id="child" if name.startswith("Subagent") else "")
        stats=self.stats()
        for name in CLAUDE_HOOKS:
            self.assertEqual(stats["hooks"][name],1,name)
            records=self.store.events(0,time.time(),hook=name)
            self.assertEqual(len(records),1,name)
            self.assertEqual(records[0]["event_name"],name)

    def test_observation_events_leave_state_presence_and_rewards_unchanged(self):
        self.send("PreToolUse",tool_name="Edit",tool_use_id="edit")
        before=self.store.actors()[0]["updated_at"]
        for i,name in enumerate(("Notification","TaskCompleted","MessageDisplay","FileChanged","WorktreeCreate"),1):
            self.send(name,i,delta="SECRET_TEXT",message="SECRET_TEXT",file_path="SECRET_PATH")
        self.assertEqual(self.store.main_state()["state"],"writing")
        self.assertEqual(self.store.actors()[0]["updated_at"],before)
        self.assertEqual(self.stats()["game"]["xp"],0)
        self.assertNotIn("SECRET_",json.dumps(self.store.events(0,time.time())))

    def test_older_payloads_associate_synchronous_turns(self):
        for name, offset in (("UserPromptSubmit",0),("Stop",1),("Stop",2),
                             ("UserPromptSubmit",3),("Stop",4)):
            self.send(name, offset, prompt_id=None)
        self.assertEqual(self.stats()["overview"]["turns"], 2)
        self.assertEqual(self.stats()["game"]["xp"], 40)

    def test_session_end_after_stop_immediately_ends_presence(self):
        self.send("UserPromptSubmit")
        self.send("SubagentStart",1,agent_id="child")
        self.send("Stop",2)
        self.assertTrue(self.send("SessionEnd",3)["applied"])
        self.assertTrue(all(not actor["online"] for actor in self.store.actors()))
        self.assertEqual(self.stats()["game"]["xp"],20)
        self.assertFalse(self.send("PostToolUse",4,tool_use_id="late")["applied"])

    def test_compaction_and_subagent_do_not_overwrite_main(self):
        self.send("PreToolUse", tool_name="Edit", tool_use_id="edit")
        self.send("PreCompact", 1)
        self.send("PostCompact", 2)
        self.send("SubagentStart", 3, agent_id="child")
        self.send("SubagentStop", 4, agent_id="child")
        self.assertEqual(self.store.main_state()["state"], "writing")

class ClaudeAppTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        existing.AppTests.setUpClass.__func__(cls)
    setUp = existing.AppTests.setUp
    tearDown = existing.AppTests.tearDown

    def test_endpoint_uses_route_source_and_preserves_auth(self):
        self.assertEqual(self.client.post("/hooks/claude_code", json=native("UserPromptSubmit",provider="codex")).status_code,200)
        self.assertEqual(self.client.get("/status").json["state"],"researching")
        self.assertEqual(self.app.event_store.actors()[0]["source"],"claude_code")
        self.assertEqual(self.client.post("/hooks/claude_code",json=native("Stop"),environ_overrides={"REMOTE_ADDR":"192.0.2.1"}).status_code,403)
        with patch.dict(os.environ,{"STAR_OFFICE_HOOK_TOKEN":"fixture-token"}):
            self.assertEqual(self.client.post("/hooks/claude_code",json=native("Stop")).status_code,401)
            self.assertEqual(self.client.post("/hooks/claude_code",json=native("Stop"),headers={"Authorization":"Bearer fixture-token"}).status_code,200)
        self.assertEqual(self.client.post("/hooks/claude_code",json=native("Interrupt")).status_code,400)
        self.assertEqual(self.client.post("/hooks/codex",json=native("PostToolUseFailure")).status_code,400)

    def test_claude_child_is_visible_with_actual_source(self):
        self.client.post("/hooks/claude_code",json=native("PreToolUse",tool_name="Edit",tool_use_id="edit"))
        self.client.post("/hooks/claude_code",json=native("SubagentStart",agent_id="child"))
        self.assertEqual(self.client.get("/status").json["state"],"writing")
        children=[a for a in self.client.get("/agents").json if a.get("source")=="claude_code"]
        self.assertEqual(len(children),1)
        self.assertIn("Claude Code",children[0]["name"])

class ClaudeObserverTests(unittest.TestCase):
    def test_forwarding_excludes_sensitive_content_and_retains_native_identity(self):
        event=forwardable_event(native("PostToolUseFailure",error="SECRET",tool_input={"command":"SECRET"},
                                      cwd="SECRET",transcript_path="SECRET",tool_use_id="tool-1"),"claude_code")
        self.assertNotIn("SECRET",json.dumps(event))
        self.assertEqual(event["prompt_id"],"prompt-1")
        self.assertEqual(normalize_hook(event,"claude_code")["outcome"],"error")

    def test_real_observer_records_locally_and_fails_open(self):
        with tempfile.TemporaryDirectory() as directory:
            db=Path(directory)/"events.sqlite3"; state=Path(directory)/"state.json"
            env={**os.environ,"STAR_OFFICE_EVENTS_DB":str(db),"STAR_OFFICE_STATE_FILE":str(state),"STAR_OFFICE_URL":"","STAR_OFFICE_HOOK_DEBUG":""}
            for payload in (native("UserPromptSubmit"),native("Stop"),native("Stop"),"invalid"):
                result=subprocess.run([sys.executable,"-B",str(ROOT/"claude_hook.py")],
                                      input=json.dumps(payload).encode(),env=env,capture_output=True,timeout=5)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(json.loads(result.stdout),{})
                self.assertEqual(result.stderr,b"")
            stats=EventStore(db).stats(0,time.time())
            self.assertEqual(stats["overview"]["turns"],1)
            self.assertEqual(stats["game"]["xp"],20)
            self.assertEqual(json.loads(state.read_text(encoding="utf-8"))["state"],"idle")

    def test_generated_exec_hook_runs_spaced_paths_without_shell(self):
        spec=importlib.util.spec_from_file_location("claude_config",ROOT/"scripts/claude_hooks_config.py")
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix="star hooks '") as directory:
            script=Path(directory)/"observer spaced.py"
            script.write_text('import json,sys; print(json.dumps([sys.executable,sys.dont_write_bytecode,json.load(sys.stdin)]))',encoding="utf-8")
            handler=module.build_config(script=script)["hooks"]["SessionEnd"][0]["hooks"][0]
            result=subprocess.run([handler["command"],*handler["args"]],input='{"probe":42}',capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stderr)
            interpreter,no_bytecode,payload=json.loads(result.stdout)
            self.assertEqual(Path(interpreter),Path(sys.executable))
            self.assertTrue(no_bytecode)
            self.assertEqual(payload,{"probe":42})

    def test_config_contains_native_events_and_no_codex_only_fields(self):
        spec=importlib.util.spec_from_file_location("claude_config",ROOT/"scripts/claude_hooks_config.py")
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        config=module.build_config(script=ROOT/"space dir/claude_hook.py",python="C:/Python Space/python.exe")
        self.assertEqual(set(config["hooks"]),set(CLAUDE_OBSERVER_HOOKS))
        example=json.loads((ROOT/"integrations/claude_code/hooks.example.json").read_text(encoding="utf-8"))
        self.assertEqual(set(example["hooks"]),set(CLAUDE_OBSERVER_HOOKS))
        self.assertEqual(len(CLAUDE_ASYNC_HOOKS),19)
        for event, entries in config["hooks"].items():
            handler=entries[0]["hooks"][0]
            expected={"type","command","args","timeout"} | ({"async"} if event in CLAUDE_ASYNC_HOOKS else set())
            self.assertEqual(set(handler),expected)
            self.assertEqual(handler.get("async",False),event in CLAUDE_ASYNC_HOOKS)
            self.assertEqual(handler["timeout"],3)
            self.assertEqual(handler["command"],"C:/Python Space/python.exe")
            self.assertEqual(handler["args"],["-B",str((ROOT/"space dir/claude_hook.py").resolve())])
        result=subprocess.run([sys.executable,"-B",str(ROOT/"scripts/claude_hooks_config.py")],capture_output=True,timeout=5)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(set(json.loads(result.stdout)["hooks"]),set(CLAUDE_OBSERVER_HOOKS))

if __name__ == "__main__":
    unittest.main()
