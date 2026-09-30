"""Lifetime hook milestones, derived from the ledger without a second save file."""
from collections import Counter

# Stable IDs preserve the original four keepsakes.
ACHIEVEMENTS = (
    ("first_session", "sessions", "SessionStart", 1),
    ("session_10", "sessions", "SessionStart", 10),
    ("session_50", "sessions", "SessionStart", 50),
    ("session_closed", "sessions", "SessionEnd", 1),
    ("first_prompt", "turns", "UserPromptSubmit", 1),
    ("prompt_25", "turns", "UserPromptSubmit", 25),
    ("first_turn", "turns", "Stop", 1),
    ("turn_25", "turns", "Stop", 25),
    ("turn_100", "turns", "Stop", 100),
    ("first_tool", "tools", "PreToolUse", 1),
    ("tool_started_100", "tools", "PreToolUse", 100),
    ("first_tool_success", "tools", "PostToolUse", 1),
    ("tool_100", "tools", "PostToolUse", 100),
    ("tool_1000", "tools", "PostToolUse", 1000),
    ("first_compact", "context", "PreCompact", 1),
    ("context_keeper", "context", "PostCompact", 1),
    ("compact_10", "context", "PostCompact", 10),
    ("compact_50", "context", "PostCompact", 50),
    ("first_delegate", "team", "SubagentStart", 1),
    ("delegate_10", "team", "SubagentStart", 10),
    ("teamwork", "team", "SubagentStop", 1),
    ("teamwork_10", "team", "SubagentStop", 10),
    ("first_permission", "control", "PermissionRequest", 1),
    ("first_interrupt", "control", "Interrupt", 1),
)

def build_achievements(rows):
    """Count identifiable activities once; compact cycles have only event IDs."""
    seen = set()
    counts = Counter()
    for row in rows:
        name = row["event_name"]
        # Tool completion only earns a milestone when no explicit error was reported.
        if name == "PostToolUse" and row["outcome"] != "ok":
            continue
        identity = row["event_id"]
        if name in {"SessionStart", "SessionEnd"}:
            identity = row["session_id"] or identity
        elif name in {"PreToolUse", "PostToolUse", "PermissionRequest"}:
            identity = row["tool_id"] or identity
        elif name in {"UserPromptSubmit", "Stop", "Interrupt"}:
            identity = row["turn_id"] or identity
        elif name in {"SubagentStart", "SubagentStop"}:
            identity = row["turn_id"] or row["session_id"] or identity
        key = (row["actor_id"], name, identity)
        if key not in seen:
            seen.add(key)
            counts[name] += 1
    return [
        {"id": badge_id, "category": category, "hook": hook, "target": target,
         "current": counts[hook], "earned": counts[hook] >= target}
        for badge_id, category, hook, target in ACHIEVEMENTS
    ]
