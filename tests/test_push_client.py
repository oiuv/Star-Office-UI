"""Client identity survives a lost join reply but test launches stay independent."""
import importlib.util
import json
import io
import os
from contextlib import redirect_stdout
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent.parent

class PushClientTests(unittest.TestCase):
    def test_state_sources_use_local_files_then_http(self):
        for script in ("office-agent-push.py", "frontend/office-agent-push.py"):
            with self.subTest(script=script), tempfile.TemporaryDirectory() as directory:
                state_path = Path(directory) / "state.json"
                state_path.write_text(json.dumps({"state": "writing", "detail": "local task"}), encoding="utf-8")
                spec = importlib.util.spec_from_file_location("push_client_source_test", ROOT / script)
                module = importlib.util.module_from_spec(spec)
                with patch.dict(os.environ, {"OFFICE_JOIN_KEY": "fixture", "OFFICE_LOCAL_STATE_FILE": ""}), patch("os.getcwd", return_value=directory):
                    spec.loader.exec_module(module)
                module.VERBOSE = False
                self.assertEqual(module.DEFAULT_STATE_CANDIDATES, [
                    str(state_path), str((ROOT / script).parent / "state.json"),
                ])
                get = Mock(return_value=SimpleNamespace(status_code=200, json=lambda: {"state": "researching", "detail": "http task"}))
                with patch.dict(sys.modules, {"requests": SimpleNamespace(get=get)}):
                    self.assertEqual(module.fetch_local_status(), {"state": "writing", "detail": "local task"})
                    get.assert_not_called()
                    explicit = Path(directory) / "explicit.json"
                    explicit.write_text(json.dumps({"state": "syncing", "detail": "explicit task"}), encoding="utf-8")
                    module.LOCAL_STATE_FILE = str(explicit)
                    self.assertEqual(module.fetch_local_status()["state"], "syncing")
                    explicit.unlink()
                    state_path.unlink()
                    # Keep the fallback isolated from the checkout's real runtime state.
                    module.DEFAULT_STATE_CANDIDATES = [str(state_path), str(Path(directory) / "script" / "state.json")]
                    self.assertEqual(module.fetch_local_status(), {"state": "researching", "detail": "http task"})
                    get.assert_called_once()

    def test_identity_is_saved_before_join_and_reused_after_retry(self):
        for script in ("office-agent-push.py", "frontend/office-agent-push.py"):
            with self.subTest(script=script), tempfile.TemporaryDirectory() as directory:
                spec = importlib.util.spec_from_file_location("push_client_test", ROOT / script)
                module = importlib.util.module_from_spec(spec)
                with patch.dict(os.environ, {"OFFICE_JOIN_KEY": "fixture"}):
                    spec.loader.exec_module(module)
                module.STATE_FILE = str(Path(directory) / "client.json")
                local = {"agentName": "Guest", "joinKey": "fixture"}
                post = Mock(side_effect=TimeoutError("lost reply"))
                with patch.dict(sys.modules, {"requests": SimpleNamespace(post=post)}), redirect_stdout(io.StringIO()):
                    with self.assertRaises(TimeoutError): module.do_join(local)
                    cached = json.loads(Path(module.STATE_FILE).read_text(encoding="utf-8"))
                    post.side_effect = None
                    post.return_value = SimpleNamespace(status_code=200, json=lambda: {"ok": True, "agentId": "visitor"})
                    self.assertTrue(module.do_join(cached))
                self.assertEqual(post.call_args_list[0].kwargs["json"]["clientId"], post.call_args_list[1].kwargs["json"]["clientId"])
                self.assertTrue(cached["joined"])
                if hasattr(module, "create_local_state"):
                    self.assertNotIn("clientId", module.create_local_state())
                    self.assertIsNone(module.create_local_state()["agentId"])
                else:
                    self.assertEqual(module.load_local_state()["clientId"], cached["clientId"])
