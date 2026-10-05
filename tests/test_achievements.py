"""Achievement behavior, using fixtures and a temporary ledger only."""
import sys
import json
import tempfile
import unittest
from collections import Counter
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from achievements import (ACHIEVEMENTS, REPEATABLE_ACHIEVEMENTS, achievement_progress,
                          build_achievements, build_collection, build_explorations, build_monthly_badges)
from event_store import EventStore
from hook_events import HOOKS


def event(name, identity, **extra):
    row = dict(event_id=str(identity), event_name=name, actor_id="main", actor_name="Star",
               source="codex", state="idle", detail="fixture", occurred_at=1000,
               session_id="", turn_id="", tool_id="", outcome="ok", metadata={})
    row.update(extra)
    return row


def badges(rows):
    return {badge["id"]: badge for badge in build_achievements(rows)}


def at(year, month, day, hour=12):
    return datetime(year, month, day, hour).timestamp()


def month_events(year=2026, month=1, days=10):
    rows = [event("Stop", f"{year}-{month}-turn-{i}", turn_id=f"{year}-{month}-turn-{i}",
                  occurred_at=at(year, month, i % days + 1)) for i in range(30)]
    rows += [event("PostToolUse", f"{year}-{month}-tool-{i}", tool_id=f"{year}-{month}-tool-{i}",
                   occurred_at=at(year, month, days)) for i in range(300)]
    return rows


class AchievementTests(unittest.TestCase):
    def test_eight_tracks_have_two_fixed_badges_and_one_advanced(self):
        catalog = badges([])
        self.assertEqual(len(catalog), 24)
        tracks = ("sessions", "prompts", "turns", "tool_attempts", "tools", "context", "delegation", "team")
        self.assertEqual(Counter(b["category"] for b in catalog.values()),
                         {name: 3 for name in tracks})
        self.assertEqual(len(REPEATABLE_ACHIEVEMENTS), 8)
        self.assertEqual(len({b["hook"] for b in catalog.values()}), 8)
        for category in tracks:
            group = [b for b in catalog.values() if b["category"] == category]
            self.assertEqual([b["kind"] for b in group], ["basic", "milestone", "advanced"])
            self.assertEqual([b["repeatable"] for b in group], [False, False, True])
            self.assertEqual(len({b["hook"] for b in group}), 1)
            targets = [b["target"] for b in group]
            self.assertEqual(targets[0], 1)
            self.assertLess(targets[0], targets[1])
            self.assertLess(targets[1], targets[2])
        self.assertTrue(all(not b["earned"] and b["current"] == 0 for b in catalog.values()))

    def test_fixed_milestones_unlock_once_even_after_advanced_leveling(self):
        for entry in ACHIEVEMENTS:
            if entry[0] in REPEATABLE_ACHIEVEMENTS:
                continue
            before = achievement_progress(*entry, entry[3] - 1)
            exact = achievement_progress(*entry, entry[3])
            later = achievement_progress(*entry, entry[3] * 10000)
            self.assertFalse(before["earned"])
            self.assertTrue(exact["earned"])
            self.assertTrue(later["earned"])
            self.assertFalse(later["repeatable"])
            self.assertNotIn("level", later)

    def test_every_advanced_badge_doubles_cumulative_thresholds_exactly(self):
        for entry in ACHIEVEMENTS:
            if entry[0] not in REPEATABLE_ACHIEVEMENTS:
                continue
            base = entry[3]
            for level in (1, 2, 3, 10, 55):
                threshold = base * 2 ** (level - 1)
                with self.subTest(badge=entry[0], level=level):
                    before = achievement_progress(*entry, threshold - 1)
                    self.assertEqual(before["level"], level - 1)
                    self.assertEqual(before["remaining"], 1)
                    exact = achievement_progress(*entry, threshold)
                    self.assertEqual(exact["level"], level)
                    self.assertEqual(exact["level_progress"], 0)
                    self.assertEqual(exact["next_target"], threshold * 2)
                    self.assertEqual(exact["level_target"], threshold)
                    self.assertTrue(exact["earned"])

    def test_two_thousand_successes_do_not_grant_twenty_levels(self):
        result = badges([event("PostToolUse", i) for i in range(2338)])["tool_1000"]
        self.assertEqual((result["current"], result["level"], result["level_progress"]), (2338, 2, 338))
        self.assertEqual((result["next_target"], result["level_target"], result["remaining"]), (4000, 2000, 1662))

    def test_visual_tiers_do_not_cap_numeric_levels(self):
        for level, tier in [(0,0),(1,1),(2,2),(3,3),(4,3),(5,5),(6,5),(7,7),(9,7),(10,10),(60,10)]:
            count = 7 if not level else 1000 * 2 ** (level - 1) + 7
            result = achievement_progress("tool_1000", "tools", "PostToolUse", 1000, count)
            self.assertEqual((result["level"], result["tier"], result["level_progress"]), (level, tier, 7))

    def test_history_survives_period_changes_and_restart_without_bonus_xp(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.sqlite3"
            store = EventStore(path)
            for i in range(75):
                store.record(event("PostCompact", i))
            store.record(event("Stop", "done"))
            full, recent = store.stats(0, 2000), EventStore(path).stats(1500, 2000)
            badge = next(b for b in recent["game"]["badges"] if b["id"] == "compact_50")
            self.assertEqual((badge["level"], badge["level_progress"], badge["next_target"]), (1, 25, 100))
            self.assertEqual(full["game"]["badges"], recent["game"]["badges"])
            self.assertEqual(full["game"]["collection"], recent["game"]["collection"])
            self.assertEqual(full["game"]["xp"], 20)
            self.assertEqual(recent["game"]["xp"], 20)
            self.assertEqual(recent["game"]["period_xp"], 0)

    def test_tool_basic_requires_success_and_is_one_time(self):
        result = badges([event("PostToolUse", "failed", outcome="error"), event("PreToolUse", "attempt")])
        self.assertFalse(result["first_tool_success"]["earned"])
        result = badges([event("PostToolUse", i) for i in range(99)])
        self.assertTrue(result["first_tool_success"]["earned"])
        self.assertNotIn("level", result["first_tool_success"])
        self.assertFalse(result["tool_1000"]["earned"])
        self.assertEqual(result["tool_1000"]["current"], 99)

    def test_business_replays_do_not_inflate_progress(self):
        rows = [event(name, f"{name}-{i}", session_id="session", turn_id="turn", tool_id="tool")
                for name in HOOKS if name not in {"PreCompact", "PostCompact"} for i in range(5)]
        result = badges(rows)
        for badge in result.values():
            if badge["hook"] not in {"PreCompact", "PostCompact"}:
                self.assertEqual(badge["current"], 1, badge["id"])

    def test_actors_with_same_local_ids_are_independent(self):
        rows = [event("PostToolUse", actor, actor_id=actor, tool_id="tool-1") for actor in ("main", "child")]
        self.assertEqual(badges(rows)["tool_1000"]["current"], 2)

    def test_distinct_compactions_in_one_turn_count_but_replays_do_not(self):
        rows = [event("PostCompact", i, session_id="session", turn_id="turn") for i in range(10)]
        result = badges(rows + rows)
        self.assertTrue(result["context_keeper"]["earned"])
        self.assertEqual(result["compact_50"]["current"], 10)
        self.assertFalse(result["compact_50"]["earned"])

    def test_missing_business_ids_use_event_ids(self):
        self.assertEqual(badges([event("Stop", i) for i in range(25)])["turn_100"]["current"], 25)

    def test_all_twelve_hooks_record_and_unlock_their_introductory_badges(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EventStore(Path(directory) / "events.sqlite3")
            for i, name in enumerate(HOOKS):
                store.record(event(name, i))
            data = store.stats(0, 2000)
            self.assertEqual(data["hooks"], dict.fromkeys(HOOKS, 1))
            self.assertEqual(sum(b["earned"] for b in data["game"]["badges"]), 8)
            self.assertEqual(data["game"]["xp"], 32)

    def test_heartbeats_do_not_unlock_badges_or_monthly_activity(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EventStore(Path(directory) / "events.sqlite3")
            store.record_state("writing", "working", occurred_at=1000)
            store.record_state("writing", "working", occurred_at=1010)
            data = store.stats(0, 2000)
            self.assertEqual(data["game"]["xp"], 0)
            self.assertTrue(all(b["current"] == 0 for b in data["game"]["badges"]))
            self.assertTrue(all(g["current"] == 0 for g in data["game"]["monthly"]["current"]["goals"]))

    def test_ledger_replay_has_one_badge_credit_and_one_xp_reward(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EventStore(Path(directory) / "events.sqlite3")
            for i in range(3):
                store.record(event("PostToolUse", i, tool_id="tool"))
            data = store.stats(0, 2000)
            self.assertEqual(data["overview"]["tools"], 3)
            self.assertEqual(data["game"]["xp"], 2)
            self.assertEqual(next(b for b in data["game"]["badges"] if b["id"] == "tool_1000")["current"], 1)

    def test_full_collection_requires_all_initial_unlocks_without_circular_dependency(self):
        regular = [achievement_progress(*entry, entry[3]) for entry in ACHIEVEMENTS]
        result = build_collection(regular)
        self.assertEqual((result["earned"], result["current"], result["target"]), (True, 24, 24))
        regular[-1] = achievement_progress(*ACHIEVEMENTS[-1], ACHIEVEMENTS[-1][3] - 1)
        self.assertFalse(build_collection(regular)["earned"])
        self.assertEqual(build_collection(regular)["current"], 23)
        self.assertFalse(build_collection([])["earned"])
        # No discoveries at all are required to collect the regular 24.
        self.assertFalse(any(b["earned"] for b in build_explorations([])))
        regular = [achievement_progress(*entry, entry[3]) for entry in ACHIEVEMENTS]
        self.assertTrue(build_collection(regular)["earned"])


def discovery_events():
    rows = [event(name, name, occurred_at=at(2026, 10, 5), session_id="main-session")
            for name in ("SessionEnd", "PreCompact", "PermissionRequest", "Interrupt")]
    rows += [
        event("Stop", "weekend", occurred_at=at(2026, 10, 3)),
        event("Stop", "night", occurred_at=at(2026, 10, 5, 22)),
        event("UserPromptSubmit", "early", occurred_at=at(2026, 10, 5, 6)),
        event("SessionStart", "startup", occurred_at=at(2026, 10, 5, 9), session_id="resume", metadata={"source": "startup"}),
        event("SessionStart", "resume", occurred_at=at(2026, 10, 5, 10), session_id="resume", metadata={"source": "resume"}),
        event("PostToolUse", "failure", occurred_at=at(2026, 10, 5, 11), session_id="recovery", tool_id="failed", outcome="error"),
        event("PostToolUse", "success", occurred_at=at(2026, 10, 5, 11) + 1, session_id="recovery", tool_id="success"),
    ]
    return rows


def discovered(rows, now=None):
    return {b["id"] for b in build_explorations(rows, now) if b["earned"]}


class ExplorationTests(unittest.TestCase):
    def test_ten_locked_slots_reveal_no_names_conditions_or_progress(self):
        locked = build_explorations([], at(2026, 10, 10))
        self.assertEqual(len(locked), 10)
        self.assertEqual(len({b["slot"] for b in locked}), 10)
        for item in locked:
            self.assertEqual(set(item), {"slot", "earned"})
            self.assertFalse(item["earned"])

    def test_ninth_discovery_unlocks_tenth_without_circular_requirement(self):
        rows = discovery_events()
        before = build_explorations([r for r in rows if r["event_id"] != "early"], at(2026, 10, 10))
        self.assertEqual(sum(b["earned"] for b in before), 8)
        self.assertFalse(before[-1]["earned"])
        after = build_explorations(rows, at(2026, 10, 10))
        self.assertEqual(sum(b["earned"] for b in after), 10)
        self.assertEqual(after[-1]["id"], "exploration_master")
        self.assertEqual(after, build_explorations(list(reversed(rows)) + rows, at(2026, 10, 10)))

    def test_weekend_requires_a_completed_turn_on_saturday_or_sunday(self):
        for day, expected in [(2, False), (3, True), (4, True), (5, False)]:
            rows = [event("Stop", "turn", occurred_at=at(2026, 10, day))]
            self.assertEqual("weekend_worker" in discovered(rows, at(2026, 10, 10)), expected)
        passive = [event(name, name, occurred_at=at(2026, 10, 3, 23))
                   for name in ("StateUpdate", "SessionStart", "PreToolUse", "UserPromptSubmit")]
        self.assertNotIn("weekend_worker", discovered(passive, at(2026, 10, 10)))
        self.assertNotIn("night_owl", discovered(passive, at(2026, 10, 10)))

    def test_night_and_morning_hour_boundaries_use_local_calendar(self):
        for hour, expected in [(0, True), (4, True), (5, False), (21, False), (22, True), (23, True)]:
            row = event("Stop", "night", occurred_at=at(2026, 10, 5, hour))
            self.assertEqual("night_owl" in discovered([row], at(2026, 10, 10)), expected)
        for hour, expected in [(4, False), (5, True), (7, True), (8, False)]:
            row = event("UserPromptSubmit", "early", occurred_at=at(2026, 10, 5, hour))
            self.assertEqual("early_bird" in discovered([row], at(2026, 10, 10)), expected)

    def test_future_events_and_later_replays_do_not_unlock_time_discoveries(self):
        rows = [event("Stop", "first", turn_id="same", occurred_at=at(2026, 10, 2)),
                event("Stop", "replay", turn_id="same", occurred_at=at(2026, 10, 3, 23))]
        self.assertNotIn("weekend_worker", discovered(rows, at(2026, 10, 10)))
        self.assertNotIn("night_owl", discovered(rows, at(2026, 10, 10)))
        self.assertEqual(discovered(discovery_events(), at(2026, 10, 1)), set())

    def test_resume_is_detected_after_initial_start_of_same_session(self):
        rows = [r for r in discovery_events() if r["event_name"] == "SessionStart"]
        self.assertEqual(discovered(rows, at(2026, 10, 10)), {"session_resumed"})
        rows[1]["metadata"] = json.dumps({"source": "resume"})
        self.assertEqual(discovered(rows, at(2026, 10, 10)), {"session_resumed"})
        rows[1]["metadata"] = {"source": "compact"}
        self.assertEqual(discovered(rows, at(2026, 10, 10)), set())

    def test_recovery_needs_a_later_different_tool_in_same_actor_and_session(self):
        fail = event("PostToolUse", "fail", actor_id="a", session_id="s", tool_id="failed", outcome="error")
        success = event("PostToolUse", "ok", actor_id="a", session_id="s", tool_id="ok", occurred_at=1001)
        self.assertIn("second_wind", discovered([success, fail], 2000))
        for changed in [{"actor_id": "b"}, {"session_id": "other"}, {"tool_id": "failed"},
                        {"occurred_at": 1000}, {"occurred_at": 999}, {"outcome": "error"}]:
            self.assertNotIn("second_wind", discovered([fail, dict(success, **changed)], 2000), changed)
        self.assertNotIn("second_wind", discovered([dict(fail, session_id=""), dict(success, session_id="")], 2000))
        self.assertEqual(badges([fail, success])["tool_1000"]["current"], 1)

    def test_rare_hook_discoveries_do_not_change_regular_collection(self):
        rows = [event(name, name) for name in ("SessionEnd", "PreCompact", "PermissionRequest", "Interrupt")]
        self.assertEqual(discovered(rows, 2000), {"session_closed", "first_compact", "first_permission", "first_interrupt"})
        self.assertEqual(build_achievements(rows), build_achievements([]))
        self.assertEqual(build_collection(build_achievements(rows))["target"], 24)
        self.assertEqual(build_collection(build_achievements(rows))["current"], 0)

    def test_recorded_discoveries_survive_restart_and_date_filters_without_bonus_xp(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.sqlite3"
            store = EventStore(path)
            for row in discovery_events():
                store.record(row)
            with patch("achievements.time.time", return_value=at(2026, 10, 10)):
                full = store.stats(0, at(2026, 10, 10))
                recent = EventStore(path).stats(at(2026, 10, 9), at(2026, 10, 10))
            self.assertEqual(full["game"]["exploration"], recent["game"]["exploration"])
            self.assertEqual(sum(b["earned"] for b in recent["game"]["exploration"]), 10)
            self.assertEqual(recent["game"]["collection"]["target"], 24)
            self.assertEqual(recent["game"]["xp"], 42)
            self.assertEqual(recent["game"]["period_xp"], 0)


class MonthlyTests(unittest.TestCase):
    def test_all_three_targets_required_and_nonconsecutive_days_allowed(self):
        rows = month_events()
        # Ten nonconsecutive days still qualify.
        for row in rows:
            row["occurred_at"] += (datetime.fromtimestamp(row["occurred_at"]).day - 1) * 86400
        result = build_monthly_badges(rows, at(2026, 1, 20))
        self.assertTrue(result["current"]["earned"])
        self.assertEqual(len(result["earned"]), 1)
        for metric, excluded in [("tools", rows[-1:]), ("turns", rows[:1])]:
            ids = {row["event_id"] for row in excluded}
            result = build_monthly_badges([r for r in rows if r["event_id"] not in ids], at(2026, 1, 20))
            self.assertFalse(result["current"]["earned"], metric)
        for row in rows:
            row["occurred_at"] = at(2026, 1, 1)
        self.assertFalse(build_monthly_badges(rows, at(2026, 1, 10))["current"]["earned"])

    def test_monthly_badge_requires_ten_active_days_even_when_counts_are_met(self):
        for days in (5, 9, 10):
            result = build_monthly_badges(month_events(days=days), at(2026, 1, 20))
            goals = result["current"]["goals"]
            self.assertEqual([g["target"] for g in goals], [10, 30, 300])
            self.assertEqual([g["current"] for g in goals], [days, 30, 300])
            self.assertEqual(result["current"]["earned"], days >= 10)

    def test_month_rollover_keeps_earned_history_and_resets_current(self):
        rows = month_events() + [event("Stop", "feb", occurred_at=at(2026, 2, 1))]
        result = build_monthly_badges(rows, at(2026, 2, 1))
        self.assertEqual([b["month"] for b in result["earned"]], ["2026-01"])
        self.assertEqual(result["current"]["month"], "2026-02")
        self.assertEqual([g["current"] for g in result["current"]["goals"]], [1, 1, 0])
        self.assertFalse(result["current"]["earned"])

    def test_replays_across_months_belong_to_earliest_occurrence(self):
        original = event("PostToolUse", "original", tool_id="same", occurred_at=at(2026, 1, 31))
        replay = dict(original, event_id="replay", occurred_at=at(2026, 2, 1))
        result = build_monthly_badges([replay, original], at(2026, 2, 2))
        self.assertEqual([g["current"] for g in result["current"]["goals"]], [0, 0, 0])

    def test_future_failed_and_passive_events_do_not_inflate_month(self):
        rows = [event("PostToolUse", "failed", outcome="error", occurred_at=at(2026, 1, 1)),
                event("PostToolUse", "future", occurred_at=at(2026, 1, 31))]
        rows += [event(name, name, occurred_at=at(2026, 1, 1))
                 for name in ("StateUpdate", "SessionStart", "PermissionRequest", "PreToolUse")]
        result = build_monthly_badges(rows, at(2026, 1, 10))
        self.assertEqual([g["current"] for g in result["current"]["goals"]], [0, 0, 0])

    def test_active_days_are_distinct_office_dates_not_actor_days(self):
        rows = [event("UserPromptSubmit", actor, actor_id=actor, occurred_at=at(2026, 1, 1))
                for actor in ("main", "child")]
        result = build_monthly_badges(rows, at(2026, 1, 1))
        self.assertEqual(result["current"]["goals"][0]["current"], 1)

    def test_calendar_handles_leap_year_and_midnight_boundary(self):
        self.assertEqual(build_monthly_badges([], at(2024, 2, 28))["current"]["days_left"], 2)
        self.assertEqual(build_monthly_badges([], at(2026, 2, 28))["current"]["days_left"], 1)
        midnight = at(2026, 3, 1, 0)
        rows = [event("Stop", "last", occurred_at=midnight - 1), event("Stop", "first", occurred_at=midnight)]
        result = build_monthly_badges(rows, midnight)
        self.assertEqual(result["current"]["month"], "2026-03")
        self.assertEqual(result["current"]["goals"][1]["current"], 1)

    def test_history_distinguishes_years_and_excludes_unfinished_months(self):
        rows = month_events(2025, 1) + month_events(2026, 1) + month_events(2026, 2)[:-1]
        result = build_monthly_badges(rows, at(2026, 3, 1))
        self.assertEqual([b["month"] for b in result["earned"]], ["2026-01", "2025-01"])

    def test_backfilled_month_survives_restart_filters_and_adds_no_xp(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.sqlite3"
            store = EventStore(path)
            rows = month_events()
            for row in rows[:-1]:
                store.record(row)
            with patch("achievements.time.time", return_value=at(2026, 2, 1)):
                self.assertEqual(store.stats(0, at(2026, 2, 1))["game"]["monthly"]["earned"], [])
                store.record(rows[-1])  # Late arrival completes a past month.
                full = store.stats(0, at(2026, 2, 1))
                recent = EventStore(path).stats(at(2026, 2, 1, 0), at(2026, 2, 1))
            self.assertEqual(full["game"]["monthly"], recent["game"]["monthly"])
            self.assertEqual(len(recent["game"]["monthly"]["earned"]), 1)
            self.assertEqual(recent["game"]["xp"], 30 * 20 + 300 * 2)
            self.assertEqual(recent["game"]["period_xp"], 0)


if __name__ == "__main__":
    unittest.main()
