"""Achievement behavior, using fixtures and a temporary ledger only."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from achievements import ACHIEVEMENTS, build_achievements
from event_store import EventStore
from hook_events import HOOKS


def event(name, identity, **extra):
    return dict(event_id=str(identity), event_name=name, actor_id="main", actor_name="Star",
                source="codex", state="idle", detail="fixture", occurred_at=1000,
                session_id="", turn_id="", tool_id="", outcome="ok", **extra)


def badges(rows):
    return {badge["id"]: badge for badge in build_achievements(rows)}


class AchievementTests(unittest.TestCase):
    def test_catalog_covers_twelve_hooks_and_keeps_original_badges(self):
        catalog = badges([])
        self.assertEqual(len(catalog), 24)
        self.assertEqual({entry[2] for entry in ACHIEVEMENTS}, set(HOOKS))
        self.assertTrue({"first_turn", "tool_100", "teamwork", "context_keeper"} <= catalog.keys())
        self.assertTrue(all(not badge["earned"] and badge["current"] == 0 for badge in catalog.values()))

    def test_tool_milestone_unlocks_at_one_hundred_successes(self):
        rows = [event("PostToolUse", i) for i in range(99)]
        before = badges(rows)
        self.assertFalse(before["tool_100"]["earned"])
        self.assertEqual(before["tool_100"]["current"], 99)
        rows.append(event("PostToolUse", 99))
        after = badges(rows)
        self.assertTrue(after["tool_100"]["earned"])
        self.assertFalse(after["tool_1000"]["earned"])
        self.assertEqual(after["tool_100"]["target"], 100)

    def test_failed_results_do_not_earn_success_badges(self):
        row = event("PostToolUse", "failed")
        row["outcome"] = "error"
        result = badges([row, event("PreToolUse", "attempt")])
        self.assertFalse(result["first_tool_success"]["earned"])
        self.assertEqual(result["tool_100"]["current"], 0)
        self.assertTrue(result["first_tool"]["earned"])

    def test_business_replays_do_not_inflate_progress(self):
        rows = []
        for name in ("PreToolUse", "PostToolUse", "PermissionRequest", "UserPromptSubmit",
                     "Stop", "Interrupt", "SessionStart", "SessionEnd", "SubagentStart", "SubagentStop"):
            for i in range(5):
                row = event(name, f"{name}-{i}")
                row.update(session_id="session", turn_id="turn", tool_id="tool")
                rows.append(row)
        result = badges(rows)
        for badge in result.values():
            if badge["hook"] not in ("PreCompact", "PostCompact"):
                self.assertEqual(badge["current"], 1, badge["id"])

    def test_actors_with_the_same_local_ids_are_independent(self):
        rows = []
        for actor in ("main", "child"):
            row = event("PostToolUse", actor)
            row.update(actor_id=actor, tool_id="tool-1")
            rows.append(row)
        self.assertEqual(badges(rows)["tool_100"]["current"], 2)

    def test_distinct_compactions_in_one_turn_are_counted(self):
        rows = []
        for i in range(10):
            row = event("PostCompact", i)
            row.update(session_id="session", turn_id="turn")
            rows.extend([row, dict(row)])
        result = badges(rows)
        self.assertTrue(result["context_keeper"]["earned"])
        self.assertTrue(result["compact_10"]["earned"])
        self.assertFalse(result["compact_50"]["earned"])
        self.assertEqual(result["compact_10"]["current"], 10)

    def test_missing_business_ids_use_event_ids(self):
        rows = [event("Stop", i) for i in range(25)]
        result = badges(rows)
        self.assertTrue(result["turn_25"]["earned"])
        self.assertFalse(result["turn_100"]["earned"])

    def test_large_milestones_retain_actual_counts(self):
        rows = [event("PostToolUse", i) for i in range(1005)]
        result = badges(rows)
        self.assertTrue(result["tool_1000"]["earned"])
        self.assertEqual(result["tool_1000"]["current"], 1005)

    def test_existing_history_unlocks_badges_across_periods_and_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.sqlite3"
            store = EventStore(path)
            for i, name in enumerate(HOOKS):
                store.record(event(name, i))
            lifetime = store.stats(0, 2000)
            recent = store.stats(1500, 2000)
            self.assertEqual(recent["overview"]["events"], 0)
            self.assertEqual(lifetime["game"]["badges"], recent["game"]["badges"])
            self.assertEqual(sum(b["earned"] for b in recent["game"]["badges"]), 12)
            self.assertEqual(lifetime["game"]["xp"], 32)
            reopened = EventStore(path).stats(1500, 2000)
            self.assertEqual(recent["game"]["badges"], reopened["game"]["badges"])

    def test_state_heartbeats_do_not_unlock_hook_achievements(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EventStore(Path(directory) / "events.sqlite3")
            store.record_state("writing", "working", occurred_at=1000)
            store.record_state("writing", "working", occurred_at=1010)
            data = store.stats(0, 2000)
            self.assertEqual(data["game"]["xp"], 0)
            self.assertTrue(all(b["current"] == 0 for b in data["game"]["badges"]))

    def test_ledger_tool_replay_has_one_badge_credit_and_one_xp_reward(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EventStore(Path(directory) / "events.sqlite3")
            for i in range(3):
                row = event("PostToolUse", i)
                row.update(tool_id="tool")
                store.record(row)
            data = store.stats(0, 2000)
            self.assertEqual(data["overview"]["tools"], 3)
            self.assertEqual(data["game"]["xp"], 2)
            badge = next(b for b in data["game"]["badges"] if b["id"] == "tool_100")
            self.assertEqual(badge["current"], 1)


if __name__ == "__main__":
    unittest.main()
