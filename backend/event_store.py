"""SQLite activity ledger shared by Flask, CLI and independent hook processes."""
from __future__ import annotations
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from hook_events import HOOKS, STATES, short_text

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "office-events.sqlite3"
PRESENCE_TTL = 300

def _enable_wal(db, timeout=0.8):
    """First-open journal changes can return SQLITE_BUSY without waiting."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            # Once WAL is enabled, avoid requesting another journal-mode change.
            if db.execute("PRAGMA journal_mode").fetchone()[0].lower() != "wal":
                db.execute("PRAGMA journal_mode=WAL")
            return
        except sqlite3.OperationalError as error:
            message = str(error).lower()
            if not any(word in message for word in ("locked", "busy")) or time.monotonic() >= deadline:
                raise
            time.sleep(min(0.01, max(0, deadline - time.monotonic())))


class EventStore:
    def __init__(self, path=None):
        self.path = str(path or os.getenv("STAR_OFFICE_EVENTS_DB") or DEFAULT_DB)

    @contextmanager
    def connect(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=0.8)
        db.row_factory = sqlite3.Row
        try:
            _enable_wal(db)
            db.executescript("""
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY, source TEXT NOT NULL, event_name TEXT NOT NULL,
                    actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, session_id TEXT NOT NULL,
                    turn_id TEXT NOT NULL, tool_id TEXT NOT NULL, tool_name TEXT NOT NULL,
                    state TEXT NOT NULL, detail TEXT NOT NULL, occurred_at REAL NOT NULL,
                    received_at REAL NOT NULL, outcome TEXT NOT NULL, metadata TEXT NOT NULL,
                    applied INTEGER NOT NULL, transition INTEGER NOT NULL, heartbeat INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS events_time ON events(occurred_at);
                CREATE INDEX IF NOT EXISTS events_actor_time ON events(actor_id, occurred_at);
                CREATE TABLE IF NOT EXISTS actors (
                    actor_id TEXT PRIMARY KEY, actor_name TEXT, session_id TEXT,
                    state TEXT, detail TEXT, updated_at REAL, turn_id TEXT,
                    closed_turn TEXT, resume_state TEXT, source TEXT, is_subagent INTEGER,
                    ended INTEGER DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS tools (
                    actor_id TEXT, tool_id TEXT, tool_name TEXT, state TEXT,
                    started_at REAL, completed_at REAL, outcome TEXT,
                    PRIMARY KEY(actor_id, tool_id)
                );
            """)
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def record(self, event):
        """Transactional projection; replayed IDs never inflate counts or rewards."""
        e = dict(event)
        if e.get("state") not in STATES:
            raise ValueError("Invalid animation state")
        e.setdefault("event_id", str(uuid.uuid4()))
        for key in ("session_id", "turn_id", "tool_id", "tool_name"):
            e.setdefault(key, "")
        e.setdefault("outcome", "ok")
        e.setdefault("metadata", {})
        e.setdefault("occurred_at", time.time())
        now = time.time()
        name, actor, at = e["event_name"], e["actor_id"], e["occurred_at"]
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM events WHERE event_id=?", (e["event_id"],)).fetchone():
                return {"duplicate": True, "applied": False}
            previous = db.execute("SELECT * FROM actors WHERE actor_id=?", (actor,)).fetchone()
            applied = not previous or at >= previous["updated_at"]
            if previous and name not in {"UserPromptSubmit", "SessionStart", "SubagentStart"}:
                if e["turn_id"] and previous["closed_turn"] == e["turn_id"]:
                    applied = False
                if previous["ended"] and name not in {"Stop", "Interrupt", "SessionEnd", "SubagentStop"}:
                    applied = False
            resume = previous["resume_state"] if previous else None
            closed = previous["closed_turn"] if previous else None
            if applied:
                if name == "PreCompact" and previous:
                    resume = previous["state"]
                if (name == "PostCompact" or (name == "SessionStart" and e["metadata"].get("source") == "compact")) and resume:
                    e["state"] = resume
                if name in {"Stop", "Interrupt", "SessionEnd", "SubagentStop"}:
                    closed = e["turn_id"] or closed
                elif name in {"UserPromptSubmit", "SubagentStart"}:
                    closed = None
            transition = bool(applied and (not previous or previous["state"] != e["state"]))
            heartbeat = bool(name == "StateUpdate" and previous and previous["state"] == e["state"] and previous["detail"] == e["detail"])
            fields = ("event_id", "source", "event_name", "actor_id", "actor_name", "session_id", "turn_id", "tool_id", "tool_name", "state", "detail", "occurred_at")
            values = [e[k] for k in fields] + [now, e["outcome"], json.dumps(e["metadata"], ensure_ascii=False), int(applied), int(transition), int(heartbeat)]
            db.execute("INSERT INTO events VALUES (" + ",".join("?" for _ in values) + ")", values)
            if applied:
                db.execute("""INSERT INTO actors VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(actor_id) DO UPDATE SET actor_name=excluded.actor_name,
                    session_id=excluded.session_id, state=excluded.state, detail=excluded.detail,
                    updated_at=excluded.updated_at, turn_id=excluded.turn_id, closed_turn=excluded.closed_turn,
                    resume_state=excluded.resume_state, source=excluded.source,
                    is_subagent=excluded.is_subagent, ended=excluded.ended""",
                    (actor, e["actor_name"], e["session_id"], e["state"], e["detail"], at,
                     e["turn_id"], closed, resume, e["source"], int(e["metadata"].get("is_subagent", False)),
                     int(name in {"SessionEnd", "SubagentStop"})))
                if name in {"Interrupt", "SessionEnd"} and e["session_id"]:
                    db.execute("UPDATE actors SET state='idle', detail=?, ended=1, closed_turn=turn_id, updated_at=? WHERE session_id=? AND is_subagent=1 AND updated_at<=?",
                               ("父会话已结束或中断", at, e["session_id"], at))
            if e["tool_id"] and name in {"PreToolUse", "PostToolUse"}:
                if name == "PreToolUse":
                    db.execute("""INSERT INTO tools(actor_id,tool_id,tool_name,state,started_at) VALUES (?,?,?,?,?)
                        ON CONFLICT(actor_id,tool_id) DO UPDATE SET started_at=excluded.started_at, state=excluded.state""",
                        (actor, e["tool_id"], e["tool_name"], e["state"], at))
                else:
                    db.execute("""INSERT INTO tools(actor_id,tool_id,tool_name,completed_at,outcome) VALUES (?,?,?,?,?)
                        ON CONFLICT(actor_id,tool_id) DO UPDATE SET completed_at=excluded.completed_at, outcome=excluded.outcome""",
                        (actor, e["tool_id"], e["tool_name"], at, e["outcome"]))
            return {"duplicate": False, "applied": bool(applied), "state": e["state"]}

    def record_state(self, state, detail, actor_id="main", actor_name="Star", source="api", **extra):
        event = {"event_id": str(uuid.uuid4()), "source": source, "event_name": "StateUpdate",
                 "actor_id": actor_id, "actor_name": short_text(actor_name), "state": state,
                 "detail": short_text(detail, 500), **extra}
        return self.record(event)

    def actors(self, now=None, db=None):
        now = time.time() if now is None else now
        if db is None:
            with self.connect() as connection:
                rows = connection.execute("SELECT * FROM actors ORDER BY updated_at DESC").fetchall()
        else:
            rows = db.execute("SELECT * FROM actors ORDER BY updated_at DESC").fetchall()
        return [dict(r, online=not r["ended"] and now - r["updated_at"] <= PRESENCE_TTL) for r in rows]

    def main_state(self, db=None):
        actors = self.actors(db=db)
        roots = [a for a in actors if a["source"] == "codex" and not a["is_subagent"]]
        if not roots:
            return None
        manual = [a for a in actors if a["actor_id"] == "main"]
        if manual and manual[0]["updated_at"] > roots[0]["updated_at"]:
            return None
        busy = [a for a in roots if a["online"] and a["state"] != "idle"]
        selected = (busy or roots)[0]
        return {"state": selected["state"] if selected["online"] else "idle",
                "detail": selected["detail"] if selected["online"] else "待命中（会话状态已过期）",
                "actor_id": selected["actor_id"], "hook_session_id": selected["session_id"],
                "progress": 0, "updated_at": datetime.fromtimestamp(selected["updated_at"]).isoformat(),
                "ttl_seconds": PRESENCE_TTL}

    def events(self, since, until, limit=50, state=None, hook=None):
        conditions, args = ["occurred_at>=?", "occurred_at<=?"], [since, until]
        if state:
            conditions.append("state=?"); args.append(state)
        if hook:
            conditions.append("event_name=?"); args.append(hook)
        with self.connect() as db:
            rows = db.execute("SELECT * FROM events WHERE " + " AND ".join(conditions) + " ORDER BY occurred_at DESC, received_at DESC LIMIT ?", [*args, limit]).fetchall()
        return [{**dict(row), "metadata": json.loads(row["metadata"])} for row in rows]

    def stats(self, since, until):
        with self.connect() as db:
            rows = db.execute("SELECT * FROM events WHERE occurred_at>=? AND occurred_at<=? ORDER BY occurred_at", (since, until)).fetchall()
            prior = db.execute("""SELECT e.* FROM events e WHERE applied=1 AND occurred_at<?
                AND NOT EXISTS (SELECT 1 FROM events newer WHERE newer.actor_id=e.actor_id
                    AND newer.applied=1 AND newer.occurred_at<? AND newer.occurred_at>e.occurred_at)""", (since, since)).fetchall()
            durations = db.execute("SELECT completed_at-started_at AS seconds FROM tools WHERE completed_at>=? AND completed_at<=? AND started_at IS NOT NULL AND completed_at>=started_at", (since, until)).fetchall()
            reward_rows = db.execute("SELECT * FROM events WHERE event_name IN ('Stop','SubagentStop','PostToolUse') AND outcome='ok'").fetchall()
            all_counts = dict(db.execute("SELECT event_name,COUNT(*) FROM events GROUP BY event_name").fetchall())
            terminators = db.execute("SELECT session_id, occurred_at FROM events WHERE applied=1 AND event_name IN ('SessionEnd','Interrupt') AND occurred_at<=? ORDER BY occurred_at", (until,)).fetchall()
        states = {s: {"count": 0, "transitions": 0, "seconds": 0} for s in STATES}
        hooks = {h: 0 for h in HOOKS}
        daily = {}
        for row in rows:
            states[row["state"]]["count"] += 1
            states[row["state"]]["transitions"] += row["transition"]
            if row["event_name"] in hooks:
                hooks[row["event_name"]] += 1
            day = datetime.fromtimestamp(row["occurred_at"]).strftime("%Y-%m-%d")
            item = daily.setdefault(day, {"date": day, "events": 0, "turns": 0})
            item["events"] += 1
            item["turns"] += row["event_name"] == "Stop"
        def observed_end(row, end):
            if json.loads(row["metadata"]).get("is_subagent"):
                for terminal in terminators:
                    if terminal["session_id"] == row["session_id"] and row["occurred_at"] <= terminal["occurred_at"] <= end:
                        return terminal["occurred_at"]
            return end
        previous = {}
        projected = [*prior, *(r for r in rows if r["applied"])]
        for row in sorted(projected, key=lambda r: (r["occurred_at"], r["received_at"])):
            prev = previous.get(row["actor_id"])
            if prev:
                end = observed_end(prev, min(row["occurred_at"], prev["occurred_at"] + PRESENCE_TTL, until))
                states[prev["state"]]["seconds"] += max(0, end - max(since, prev["occurred_at"]))
            previous[row["actor_id"]] = row
        for prev in previous.values():
            states[prev["state"]]["seconds"] += max(0, observed_end(prev, min(until, prev["occurred_at"] + PRESENCE_TTL)) - max(since, prev["occurred_at"]))
        for value in states.values():
            value["seconds"] = round(value["seconds"], 1)
        tools = [r for r in rows if r["event_name"] == "PostToolUse"]
        failed = sum(r["outcome"] == "error" for r in tools)
        def reward_key(row):
            identity = row["tool_id"] if row["event_name"] == "PostToolUse" else row["turn_id"]
            return row["actor_id"], row["event_name"], identity or row["event_id"]
        rewards = {}
        for row in reward_rows:
            key = reward_key(row)
            if key not in rewards or row["occurred_at"] < rewards[key]["occurred_at"]:
                rewards[key] = row
        points = {"Stop": 20, "PostToolUse": 2, "SubagentStop": 10}
        xp = sum(points[r["event_name"]] for r in rewards.values())
        period_rewards = [r for r in rewards.values() if since <= r["occurred_at"] <= until]
        period_xp = sum(points[r["event_name"]] for r in period_rewards)
        completed_turns = sum(r["event_name"] == "Stop" for r in period_rewards)
        all_success = sum(r["event_name"] == "PostToolUse" for r in rewards.values())
        badges = [
            {"id": "first_turn", "earned": all_counts.get("Stop", 0) >= 1},
            {"id": "tool_100", "earned": all_success >= 100},
            {"id": "teamwork", "earned": all_counts.get("SubagentStop", 0) >= 1},
            {"id": "context_keeper", "earned": all_counts.get("PostCompact", 0) >= 1},
        ]
        seconds = [r["seconds"] for r in durations]
        return {"since": since, "until": until, "states": states, "hooks": hooks,
                "overview": {"events": len(rows), "state_updates": sum(r["event_name"] == "StateUpdate" for r in rows),
                    "heartbeats": sum(r["heartbeat"] for r in rows), "transitions": sum(r["transition"] for r in rows),
                    "sessions": len({r["session_id"] for r in rows if r["session_id"]}),
                    "turns": completed_turns, "tools": len(tools), "tool_errors": failed,
                    "permission_requests": hooks["PermissionRequest"], "interrupts": hooks["Interrupt"],
                    "compactions": hooks["PostCompact"], "subagents": hooks["SubagentStart"],
                    "active_seconds": round(sum(v["seconds"] for s, v in states.items() if s != "idle"), 1),
                    "measured_tools": len(seconds), "average_tool_seconds": round(sum(seconds) / len(seconds), 2) if seconds else None},
                "game": {"xp": xp, "period_xp": period_xp, "level": xp // 100 + 1, "level_xp": xp % 100, "next_level_xp": 100, "badges": badges},
                "daily": [daily[k] for k in sorted(daily)], "actors": self.actors()}

def period_bounds(period, now=None):
    now = time.time() if now is None else now
    today = datetime.fromtimestamp(now).replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "today":
        return today.timestamp(), now
    if period in {"7d", "30d"}:
        return (today - timedelta(days=int(period[:-1]) - 1)).timestamp(), now
    if period == "all":
        return 0, now
    raise ValueError("period must be today, 7d, 30d or all")
