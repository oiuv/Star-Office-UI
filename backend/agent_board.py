"""Read Codex's local message board; never migrate, copy or write its data."""
from __future__ import annotations

from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import sqlite3

from flask import jsonify, request
from memo_utils import sanitize_content

try:
    import tomllib
except ImportError:  # Python 3.10
    import tomli as tomllib

DATABASE_FILE = "agent_message_board_1.sqlite"
PAGE_SIZE = 20
MAX_BODY_CHARS = 128 * 1024


class BoardUnavailable(Exception):
    pass


class BoardNotFound(Exception):
    pass


def sqlite_home() -> Path:
    """Office override > Codex config > CODEX_SQLITE_HOME > CODEX_HOME."""
    override = os.environ.get("STAR_OFFICE_CODEX_SQLITE_HOME", "").strip()
    if override:
        return Path(override).expanduser()
    home = Path(os.environ.get("CODEX_HOME", "").strip() or Path.home() / ".codex").expanduser()
    config_file = home / "config.toml"
    configured = ""
    if config_file.is_file():
        try:
            with config_file.open("rb") as stream:
                configured = tomllib.load(stream).get("sqlite_home", "")
        except (OSError, ValueError) as error:
            raise BoardUnavailable("config") from error
        if not isinstance(configured, str):
            raise BoardUnavailable("config")
    return Path(configured or os.environ.get("CODEX_SQLITE_HOME", "").strip() or home).expanduser()


@contextmanager
def _readonly(path):
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=1)
    try:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        yield connection
    finally:
        connection.close()


def _schema(connection):
    required = {
        "channels": {"board", "name", "author"},
        "posts": {"seq", "board", "id", "channel", "root", "author", "timestamp", "body_search", "payload"},
    }
    for table, columns in required.items():
        actual = {row["name"] for row in connection.execute("PRAGMA table_info(" + table + ")")}
        if not columns <= actual:
            raise BoardUnavailable("schema")
    return {row["name"] for row in connection.execute("PRAGMA table_info(channels)")}


def _summary(connection, board=None):
    where, params = (" WHERE board=?", [board]) if board else ("", [])
    result = dict(connection.execute(
        "SELECT count(*) AS messages, count(DISTINCT board) AS boards, "
        "coalesce(sum(id=root),0) AS threads, "
        "coalesce(max(seq),0) AS last_seq FROM posts" + where, params
    ).fetchone())
    # Agent paths repeat across root sessions; count each session's participants separately.
    result["agents"] = connection.execute(
        "SELECT count(*) FROM (SELECT DISTINCT board,author FROM posts" + where + ")", params
    ).fetchone()[0]
    result["boards"] = connection.execute(
        "SELECT count(*) FROM (SELECT board FROM channels" + where + " UNION SELECT board FROM posts" + where + ")",
        params + params,
    ).fetchone()[0]
    result["channels"] = connection.execute("SELECT count(*) FROM channels" + where, params).fetchone()[0]
    result["replies"] = result["messages"] - result["threads"]
    return result


def _metadata(home, identifiers):
    """Optional session titles/project basenames; no rollout paths or cwd are exposed."""
    state = home / "state_5.sqlite"
    if not state.is_file():
        return {}
    result = {}
    try:
        with _readonly(state) as connection:
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(threads)")}
            if not {"id", "title", "cwd"} <= columns:
                return {}
            for identifier in identifiers:
                row = connection.execute("SELECT title,cwd FROM threads WHERE id=?", (identifier,)).fetchone()
                if row:
                    project = re.split(r"[\\\\/]", row["cwd"].rstrip("/\\\\"))[-1] if row["cwd"] else ""
                    result[identifier] = {
                        "title": sanitize_content(row["title"] or "")[:160],
                        "project": sanitize_content(project)[:80],
                    }
    except (sqlite3.Error, OSError, TypeError, ValueError):
        pass
    return result


def _post(row):
    try:
        payload = json.loads(row["payload"])
        text = payload["text"]
        metadata = payload["metadata"]
        if not isinstance(text, str) or not isinstance(metadata, dict):
            raise ValueError("Invalid post")
        if metadata.get("message_id") != row["id"] or metadata.get("thread_id") != row["root"]:
            raise ValueError("Invalid identity")
        created = metadata.get("created_at", "")
        if not isinstance(created, str):
            created = ""
        # Keep code fences/line breaks; use the same redaction rules as session notes.
        return {
            "id": row["id"], "thread_id": row["root"], "author": row["author"],
            "created_at": created, "seq": row["seq"],
            "text": sanitize_content(text[:MAX_BODY_CHARS]),
            "truncated": len(text) > MAX_BODY_CHARS,
        }
    except (KeyError, TypeError, ValueError):
        return {
            "id": row["id"], "thread_id": row["root"], "author": row["author"],
            "created_at": "", "seq": row["seq"], "text": "", "unreadable": True,
        }


def _preview(text):
    return " ".join(text.replace("`", "").split())[:160]


def read_board(board="", channel="", thread="", author="", query="", offset=0, reply_offset=0, summary_only=False):
    home = sqlite_home()
    path = home / DATABASE_FILE
    empty = {"available": False, "status": "missing", "summary": {}, "boards": [], "channels": [],
             "authors": [], "threads": [], "posts": [], "board_id": "", "channel_name": "", "thread_id": ""}
    if not path.is_file():
        return empty
    try:
        with _readonly(path) as connection:
            channel_columns = _schema(connection)
            summary = _summary(connection)
            if summary_only:
                return {"available": True, "status": "ready", "summary": summary}
            boards = [dict(row) for row in connection.execute(
                "SELECT board AS id, count(*) AS message_count, count(DISTINCT author) AS agent_count, "
                "max(seq) AS last_seq FROM posts GROUP BY board "
                "UNION ALL SELECT board AS id,0,0,0 FROM channels "
                "WHERE board NOT IN (SELECT board FROM posts) GROUP BY board "
                "ORDER BY last_seq DESC,id LIMIT 100"
            )]
            metadata = _metadata(home, [item["id"] for item in boards])
            for item in boards:
                item.update(metadata.get(item["id"], {"title": "", "project": ""}))
            if board:
                exists = connection.execute(
                    "SELECT 1 FROM channels WHERE board=? UNION SELECT 1 FROM posts WHERE board=? LIMIT 1",
                    (board, board)
                ).fetchone()
                if not exists:
                    raise BoardNotFound("board")
            elif boards:
                board = boards[0]["id"]
            if not board:
                return {**empty, "available": True, "status": "empty", "summary": summary}
            description = "c.description" if "description" in channel_columns else "NULL"
            channels = [dict(row) for row in connection.execute(
                "SELECT c.name," + description + " AS description,count(p.seq) AS message_count,"
                "coalesce(sum(p.id=p.root),0) AS thread_count,coalesce(max(p.seq),0) AS last_seq "
                "FROM channels c LEFT JOIN posts p ON p.board=c.board AND p.channel=c.name "
                "WHERE c.board=? GROUP BY c.name ORDER BY last_seq DESC,c.name", (board,)
            )]
            for item in channels:
                item["description"] = sanitize_content(item["description"] or "")[:512]
            if channel and channel not in {item["name"] for item in channels}:
                raise BoardNotFound("channel")
            if not channel and channels:
                channel = channels[0]["name"]
            authors = [row[0] for row in connection.execute(
                "SELECT DISTINCT author FROM posts WHERE board=? AND channel=? ORDER BY author", (board, channel)
            )]
            # EXISTS includes reply matches, returning the complete discussion for context.
            match, params = ["r.board=?", "r.channel=?", "r.id=r.root"], [board, channel]
            predicates, search_params = [], []
            if author:
                predicates.append("m.author=?")
                search_params.append(author)
            if query:
                predicates.append("m.body_search LIKE ? ESCAPE '!'")
                escaped = query.lower().replace("!", "!!").replace("%", "!%").replace("_", "!_")
                search_params.append("%" + escaped + "%")
            if predicates:
                match.append("EXISTS(SELECT 1 FROM posts m WHERE m.board=r.board AND m.root=r.id AND "
                             + " AND ".join(predicates) + ")")
                params += search_params
            where = " AND ".join(match)
            total = connection.execute("SELECT count(*) FROM posts r WHERE " + where, params).fetchone()[0]
            rows = connection.execute(
                "SELECT r.*, (SELECT count(*)-1 FROM posts p WHERE p.board=r.board AND p.root=r.id) AS reply_count,"
                "(SELECT max(seq) FROM posts p WHERE p.board=r.board AND p.root=r.id) AS last_seq "
                "FROM posts r WHERE " + where + " ORDER BY last_seq DESC,r.seq DESC LIMIT ? OFFSET ?",
                [*params, PAGE_SIZE, offset]
            ).fetchall()
            threads = []
            for row in rows:
                post = _post(row)
                threads.append({k: post[k] for k in ("id", "author", "created_at", "unreadable") if k in post}
                               | {"preview": _preview(post["text"]), "reply_count": row["reply_count"],
                                  "last_seq": row["last_seq"]})
            root = None
            if thread:
                root = connection.execute("SELECT r.* FROM posts r WHERE " + where + " AND r.id=?", [*params, thread]).fetchone()
            if root is None and rows:
                root = rows[0]
            posts, reply_total, selected = [], 0, ""
            if root is not None:
                selected = root["id"]
                posts.append(_post(root))
                reply_total = connection.execute(
                    "SELECT count(*) FROM posts WHERE board=? AND root=? AND id<>root", (board, selected)
                ).fetchone()[0]
                replies = connection.execute(
                    "SELECT * FROM posts WHERE board=? AND root=? AND id<>root "
                    "ORDER BY timestamp,seq LIMIT ? OFFSET ?", (board, selected, PAGE_SIZE, reply_offset)
                ).fetchall()
                posts.extend(_post(row) for row in replies)
            return {
                "available": True, "status": "ready", "summary": summary,
                "board_summary": _summary(connection, board),
                "boards": boards, "channels": channels, "authors": authors, "threads": threads, "posts": posts,
                "board_id": board, "channel_name": channel, "thread_id": selected,
                "pagination": {"offset": offset, "limit": PAGE_SIZE, "total": total, "has_more": offset + PAGE_SIZE < total},
                "reply_pagination": {"offset": reply_offset, "limit": PAGE_SIZE, "total": reply_total,
                                     "has_more": reply_offset + PAGE_SIZE < reply_total},
            }
    except (sqlite3.Error, OSError) as error:
        raise BoardUnavailable("database") from error


def board_summary():
    """Missing/unavailable board data never interrupts activity statistics."""
    try:
        return read_board(summary_only=True)
    except BoardUnavailable:
        return {"available": False, "status": "unavailable", "summary": {}}


def register_board_routes(app):
    @app.get("/api/agent-board")
    def agent_board_view():
        try:
            args = {}
            for name in ("board", "channel", "thread", "author", "query"):
                value = request.args.get(name, "")
                if len(value) > 200:
                    raise ValueError("Filter is too long")
                args[name] = value
            for name in ("offset", "reply_offset"):
                value = int(request.args.get(name, "0"))
                if not 0 <= value <= 1_000_000:
                    raise ValueError("Invalid pagination offset")
                args[name] = value
            data = read_board(**args, summary_only=request.args.get("summary") == "1")
            response = jsonify({"ok": True, **data})
        except ValueError:
            response = jsonify({"ok": False, "status": "invalid_filter"})
            response.status_code = 400
        except BoardNotFound:
            response = jsonify({"ok": False, "status": "not_found"})
            response.status_code = 404
        except BoardUnavailable:
            response = jsonify({"ok": False, "status": "unavailable"})
            response.status_code = 503
        response.headers["Cache-Control"] = "no-store"
        return response
