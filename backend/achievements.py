"""Lifetime hook milestones, derived from the ledger without a second save file."""
import calendar
import json
import time
from collections import Counter
from datetime import datetime
from hook_events import SHARED_HOOKS

# Eight growth tracks: first activity, a fixed milestone, then unlimited growth.
ACHIEVEMENTS = (
    ("first_session", "sessions", "SessionStart", 1),
    ("session_10", "sessions", "SessionStart", 10),
    ("session_50", "sessions", "SessionStart", 50),
    ("first_prompt", "prompts", "UserPromptSubmit", 1),
    ("prompt_25", "prompts", "UserPromptSubmit", 25),
    ("prompt_100", "prompts", "UserPromptSubmit", 100),
    ("first_turn", "turns", "Stop", 1),
    ("turn_25", "turns", "Stop", 25),
    ("turn_100", "turns", "Stop", 100),
    ("first_tool", "tool_attempts", "PreToolUse", 1),
    ("tool_started_100", "tool_attempts", "PreToolUse", 100),
    ("tool_started_1000", "tool_attempts", "PreToolUse", 1000),
    ("first_tool_success", "tools", "PostToolUse", 1),
    ("tool_100", "tools", "PostToolUse", 100),
    ("tool_1000", "tools", "PostToolUse", 1000),
    ("context_keeper", "context", "PostCompact", 1),
    ("compact_10", "context", "PostCompact", 10),
    ("compact_50", "context", "PostCompact", 50),
    ("first_delegate", "delegation", "SubagentStart", 1),
    ("delegate_5", "delegation", "SubagentStart", 5),
    ("delegate_10", "delegation", "SubagentStart", 10),
    ("teamwork", "team", "SubagentStop", 1),
    ("teamwork_5", "team", "SubagentStop", 5),
    ("teamwork_10", "team", "SubagentStop", 10),
)
REPEATABLE_ACHIEVEMENTS = frozenset({
    "session_50", "prompt_100", "turn_100", "tool_started_1000",
    "tool_1000", "compact_50", "delegate_10", "teamwork_10",
})
LEVEL_TIERS = (10, 7, 5, 3, 2, 1)
MONTHLY_TARGETS = (("active_days", 10), ("prompts", 100), ("tools", 1000))


def achievement_progress(badge_id, category, hook, target, current):
    """Lv.1 at target; each subsequent cumulative threshold doubles exactly."""
    badge = {"id": badge_id, "category": category, "hook": hook, "target": target,
             "current": current, "earned": current >= target,
             "repeatable": badge_id in REPEATABLE_ACHIEVEMENTS}
    badge["kind"] = ("advanced" if badge["repeatable"] else
                     "basic" if target == 1 else "milestone")
    if badge["repeatable"]:
        level = (current // target).bit_length()
        start = target * 2 ** (level - 1) if level else 0
        next_target = target * 2 ** level
        badge.update(level=level, level_progress=current - start,
                     level_target=next_target - start, next_target=next_target,
                     remaining=next_target - current,
                     tier=next((tier for tier in LEVEL_TIERS if level >= tier), 0))
    return badge


def eligible_activities(rows):
    """All badges use native events shared by Codex and Claude Code only."""
    for row in rows:
        metadata = row["metadata"]
        if isinstance(metadata, str):
            metadata = json.loads(metadata)
        original = metadata.get("original_event_name", row["event_name"])
        if row["event_name"] in SHARED_HOOKS and original in SHARED_HOOKS:
            yield row


def unique_activities(rows, include_failed=False):
    """Share business-identity deduplication across lifetime and calendar badges."""
    seen = set()
    for row in eligible_activities(rows):
        name = row["event_name"]
        if name in {"PostToolUse", "Stop"} and row["outcome"] != "ok" and not include_failed:
            continue
        identity = row["event_id"]
        if name in {"SessionStart", "SessionEnd"}:
            identity = row["session_id"] or identity
        elif name in {"PreToolUse", "PostToolUse", "PermissionRequest"}:
            identity = row["tool_id"] or identity
        elif name in {"UserPromptSubmit", "Stop"}:
            identity = row["turn_id"] or identity
        elif name in {"SubagentStart", "SubagentStop"}:
            identity = row["turn_id"] or row["session_id"] or identity
        key = (row["actor_id"], name, identity)
        if key not in seen:
            seen.add(key)
            yield row


def build_achievements(rows):
    """Count identifiable activities once; compact cycles have only event IDs."""
    counts = Counter(row["event_name"] for row in unique_activities(rows))
    return [
        achievement_progress(badge_id, category, hook, target, counts[hook])
        for badge_id, category, hook, target in ACHIEVEMENTS
    ]


def build_collection(badges):
    """The collection requires initial unlocks, never infinite levels or months."""
    current = sum(badge["earned"] for badge in badges)
    return {"id": "all_achievements", "current": current, "target": len(badges),
            "earned": bool(badges) and current == len(badges)}



# Separate from the regular catalog: optional discoveries never block completion.
EXPLORATION_IDS = (
    "session_closed", "first_compact", "first_permission", "tool_chain",
    "weekend_worker", "night_owl", "early_bird", "session_resumed", "second_wind",
)
EXPLORATION_HOOKS = {
    "SessionEnd": "session_closed", "PreCompact": "first_compact",
    "PermissionRequest": "first_permission",
}


def build_explorations(rows, now=None):
    """Reveal a discovery only after earning it; locked slots carry no spoilers."""
    now = time.time() if now is None else now
    ordered = sorted((row for row in eligible_activities(rows) if row["occurred_at"] <= now),
                     key=lambda row: (row["occurred_at"], row["event_id"]))
    earned = set()
    # A resumed SessionStart shares the initial session ID, so inspect its
    # metadata before session-level deduplication. Presence alone earns this one.
    for row in ordered:
        if row["event_name"] == "SessionStart":
            metadata = row["metadata"]
            if isinstance(metadata, str):
                metadata = json.loads(metadata)
            if isinstance(metadata, dict) and metadata.get("source") == "resume":
                earned.add("session_resumed")

    recovery_at = {}
    turn_tools = {}
    for row in unique_activities(ordered, include_failed=True):
        name = row["event_name"]
        if name in EXPLORATION_HOOKS:
            earned.add(EXPLORATION_HOOKS[name])
        if row["outcome"] == "ok" and name in {"Stop", "UserPromptSubmit"}:
            date = datetime.fromtimestamp(row["occurred_at"])
            if name == "Stop":
                if date.weekday() >= 5:
                    earned.add("weekend_worker")
                if date.hour >= 22 or date.hour < 5:
                    earned.add("night_owl")
            elif 5 <= date.hour < 8:
                earned.add("early_bird")
        if row["session_id"]:
            key = (row["actor_id"], row["session_id"])
            if name == "PermissionRequest":
                recovery_at[key] = (row["occurred_at"], None)
            elif name == "PostToolUse":
                if row["outcome"] == "error":
                    recovery_at[key] = (row["occurred_at"], row["tool_id"] or row["event_id"])
                elif row["outcome"] == "ok" and key in recovery_at:
                    at, failed_tool = recovery_at[key]
                    if row["occurred_at"] > at and (failed_tool is None or (row["tool_id"] or row["event_id"]) != failed_tool):
                        earned.add("second_wind")
            if row["turn_id"]:
                turn = (*key, row["turn_id"])
                if name == "PostToolUse" and row["outcome"] == "ok":
                    turn_tools.setdefault(turn, set()).add(row["tool_id"] or row["event_id"])
                elif name == "Stop" and row["outcome"] == "ok" and len(turn_tools.get(turn, ())) >= 3:
                    earned.add("tool_chain")

    if all(badge_id in earned for badge_id in EXPLORATION_IDS):
        earned.add("exploration_master")
    result = []
    for index, badge_id in enumerate((*EXPLORATION_IDS, "exploration_master"), 1):
        # Opaque slots keep names and conditions out of locked API records.
        badge = {"slot": f"exploration_{index:02d}", "earned": badge_id in earned}
        if badge["earned"]:
            badge["id"] = badge_id
        result.append(badge)
    return result


def build_monthly_badges(rows, now=None):
    """Calendar rewards are reconstructed from retained history, including backfill."""
    now = time.time() if now is None else now
    today = datetime.fromtimestamp(now)
    current_month = today.strftime("%Y-%m")
    months = {}
    # Earliest occurrence owns an activity, including retries in a later month.
    for row in unique_activities(sorted(rows, key=lambda item: (item["occurred_at"], item["event_id"]))):
        if row["occurred_at"] > now or row["event_name"] not in {"UserPromptSubmit", "Stop", "PostToolUse"}:
            continue
        date = datetime.fromtimestamp(row["occurred_at"])
        month = months.setdefault(date.strftime("%Y-%m"), {"days": set(), "prompts": 0, "tools": 0})
        month["days"].add(date.date())
        if row["event_name"] == "UserPromptSubmit":
            month["prompts"] += 1
        elif row["event_name"] == "PostToolUse":
            month["tools"] += 1

    def badge_for(key):
        counts = months.get(key, {"days": set(), "prompts": 0, "tools": 0})
        totals = {"active_days": len(counts["days"]), "prompts": counts["prompts"], "tools": counts["tools"]}
        goals = [{"metric": metric, "current": totals[metric], "target": target}
                 for metric, target in MONTHLY_TARGETS]
        return {"month": key, "earned": all(g["current"] >= g["target"] for g in goals), "goals": goals}

    current = badge_for(current_month)
    current["days_left"] = calendar.monthrange(today.year, today.month)[1] - today.day + 1
    earned = [badge_for(key) for key in sorted(months, reverse=True)]
    return {"current": current, "earned": [badge for badge in earned if badge["earned"]]}
