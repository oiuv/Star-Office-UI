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
