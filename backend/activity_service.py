"""Update the ledger and state-file mirror without requiring a web server."""
from __future__ import annotations
import os
from pathlib import Path
from event_store import EventStore
from hook_events import normalize_hook
from store_utils import _save_json

def apply_hook(payload, store=None, state_file=None):
    store = store or EventStore()
    event = normalize_hook(payload)
    result = store.record(event)
    if result["applied"] and not event["metadata"]["is_subagent"]:
        path = state_file or os.getenv("STAR_OFFICE_STATE_FILE") or Path(__file__).resolve().parent.parent / "state.json"
        # Serialize projection and mirroring across independent hook processes.
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            state = store.main_state(db=db)
            if state:
                _save_json(str(path), state)
    return {"ok": True, **result}
