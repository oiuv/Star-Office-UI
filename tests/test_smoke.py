"""Deployment verification must not inject states or activity."""
import importlib.util
import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("office_smoke", Path(__file__).resolve().parents[1] / "scripts/smoke_test.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class SmokeTests(unittest.TestCase):
    def test_checks_pages_and_data_without_writing(self):
        with patch.object(sys, "argv", ["smoke_test.py"]), patch.object(smoke, "req", return_value=(200, "{}")) as request:
            with redirect_stdout(io.StringIO()):
                self.assertEqual(smoke.main(), 0)
        calls = [call.args for call in request.call_args_list]
        self.assertTrue(calls)
        self.assertTrue(all(args[0] == "GET" and len(args) == 2 for args in calls))
        for endpoint in ("/recent-memo", "/stats", "/api/stats?period=today", "/api/events?period=today&limit=1"):
            self.assertTrue(any(args[1].endswith(endpoint) for args in calls))

    def test_unavailable_endpoint_fails_installation_check(self):
        def response(method, url, **kwargs):
            return (503, "unavailable") if url.endswith("/recent-memo") else (200, "{}")
        output = io.StringIO()
        with patch.object(sys, "argv", ["smoke_test.py"]), patch.object(smoke, "req", side_effect=response):
            with redirect_stdout(output):
                self.assertEqual(smoke.main(), 1)
        self.assertIn("GET /recent-memo: expected 200, got 503", output.getvalue())
