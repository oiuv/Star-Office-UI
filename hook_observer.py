#!/usr/bin/env python3
"""Agent hook observer. Failures never block or approve the agent's work."""
from __future__ import annotations
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))
from hook_events import normalize_hook, tool_failed
from image_client import NoRedirect, validate_base_url

def forwardable_event(payload, provider="codex"):
    if not isinstance(payload, dict):
        raise ValueError("Hook input must be an object")
    keys = ("hook_event_name","session_id","turn_id","prompt_id","agent_id","agent_type",
            "tool_name","tool_use_id","source","trigger","model","permission_mode","stop_hook_active",
            "notification_type","event","from_model","to_model","task_id","mcp_server_name","action","reason",
            "message_id","index","final")
    event = {key:payload[key] for key in keys if key in payload}
    event["tool_failed"] = tool_failed(payload.get("tool_response"))
    event["occurred_at"] = time.time()
    normalized = normalize_hook(event, provider)
    if provider == "codex":
        event["event_id"] = normalized["event_id"]
    elif "event_id" in payload:
        event["event_id"] = payload["event_id"]
    return event

def main(provider="codex"):
    worktree_create = False
    try:
        stream = getattr(sys.stdin,"buffer",sys.stdin)
        raw = stream.read(2_000_001)
        if len(raw)>2_000_000:
            raise ValueError("Hook input exceeds 2 MB")
        payload = json.loads(raw)
        worktree_create = provider == "claude_code" and isinstance(payload, dict) and payload.get("hook_event_name") == "WorktreeCreate"
        event = forwardable_event(payload, provider)
        url = os.getenv("STAR_OFFICE_URL","").strip().rstrip("/")
        if url:
            headers = {"Content-Type":"application/json"}
            token = os.getenv("STAR_OFFICE_HOOK_TOKEN","")
            if token:
                headers["Authorization"] = "Bearer " + token
            url = validate_base_url(url)
            request = urllib.request.Request(
                url + "/hooks/" + provider,data=json.dumps(event).encode("utf-8"),
                headers=headers,method="POST")
            with urllib.request.build_opener(NoRedirect()).open(request,timeout=1.2) as response:
                response.read(1024)
        else:
            from activity_service import apply_hook
            apply_hook(event, provider=provider)
    except Exception as error:
        if os.getenv("STAR_OFFICE_HOOK_DEBUG")=="1":
            print("Star Office hook skipped: " + type(error).__name__,file=sys.stderr)
    finally:
        # A custom WorktreeCreate handler owns stdout (the created path).
        if not worktree_create:
            print("{}")
    return 0

if __name__=="__main__":
    sys.exit(main())
