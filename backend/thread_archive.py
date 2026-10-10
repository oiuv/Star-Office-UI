"""Read-only, paginated display of Codex thread metadata, without conversation history."""
from __future__ import annotations

import json
import re
import sqlite3

from flask import jsonify, request
from agent_board import BoardUnavailable, _readonly, sqlite_home
from memo_utils import sanitize_content

DATABASE_FILE = "state_5.sqlite"
PAGE_SIZE = 20
TEXT_FIELDS = {
    "title": 240, "name": 240, "preview": 3000, "first_user_message": 3000,
    "source": 2000, "thread_source": 160, "cwd": 2000, "model": 160,
    "model_provider": 160, "reasoning_effort": 80, "git_branch": 240,
    "git_sha": 80, "cli_version": 80, "agent_path": 240,
    "agent_nickname": 160, "agent_role": 160,
}
NUMBER_FIELDS = ("tokens_used", "archived", "is_pinned", "created_at", "updated_at",
                 "created_at_ms", "updated_at_ms", "recency_at", "recency_at_ms")


def _startup_source(value):
    try:
        parsed = json.loads(value)
    except (ValueError, TypeError):
        return value or ""
    if isinstance(parsed, str):
        return parsed
    if isinstance(parsed, dict):
        for kind, detail in parsed.items():
            if isinstance(detail, str):
                return kind + "." + detail
            if isinstance(detail, dict):
                subtype = next(iter(detail), "")
                return kind + "." + (str(detail[subtype]) if subtype == "other" else subtype)
    return value or ""


def _time(row, prefix):
    return row.get(prefix + "_ms") or (row.get(prefix) or 0) * 1000


def read_threads(query="", source="", model="", project="", archived="", sort="recent", offset=0):
    path = sqlite_home() / DATABASE_FILE
    if not path.is_file():
        return {"available": False, "status": "missing", "threads": [], "summary": {},
                "facets": {}, "pagination": {"offset": 0, "limit": PAGE_SIZE, "total": 0}}
    with _readonly(path) as connection:
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(threads)")}
        if not {"id", "title", "source", "cwd", "tokens_used", "created_at", "updated_at"} <= columns:
            raise BoardUnavailable("schema")

        def expression(name, default="NULL"):
            return 't."' + name + '"' if name in columns else default

        # Project basenames work for Windows paths even when served on Linux.
        connection.create_function("project_name", 1, lambda cwd: re.split(r"[\\\\/]", (cwd or "").rstrip("/\\\\"))[-1])
        project_expr = "project_name(t.cwd)"
        joins = ""
        project_columns = {row["name"] for row in connection.execute("PRAGMA table_info(projects)")}
        if "project_id" in columns and {"id", "name"} <= project_columns:
            joins = " LEFT JOIN projects p ON p.id=t.project_id"
            project_expr = "coalesce(nullif(p.name,''),project_name(t.cwd))"
        source_expr = "coalesce(" + expression("thread_source") + ",'')"
        model_expr = "coalesce(" + expression("model") + ",'')"
        base = " FROM threads t" + joins
        terms, params = [], []
        if query:
            fields = [expression(field, "''") for field in
                      ("id", "title", "name", "preview", "first_user_message", "agent_path", "agent_nickname")]
            terms.append("(" + " OR ".join("instr(lower(coalesce(" + field + ",'')),lower(?))>0" for field in fields) + ")")
            params.extend([query] * len(fields))
        for value, expr in ((source, source_expr), (model, model_expr), (project, project_expr)):
            if value:
                terms.append(expr + "=?")
                params.append(value)
        if archived:
            terms.append("coalesce(" + expression("archived", "0") + ",0)=?")
            params.append(int(archived))
        where = " WHERE " + " AND ".join(terms) if terms else ""
        summary_sql = "SELECT count(*) AS threads,coalesce(sum(t.tokens_used),0) AS tokens_used," \
                      "coalesce(sum(coalesce(" + expression("archived", "0") + ",0)<>0),0) AS archived"
        summary = dict(connection.execute(summary_sql + base).fetchone())
        filtered = dict(connection.execute(summary_sql + base + where, params).fetchone())
        facets = {}
        for key, expr in (("sources", source_expr), ("models", model_expr), ("projects", project_expr)):
            facets[key] = [dict(row) for row in connection.execute(
                "SELECT " + expr + " AS value,count(*) AS count" + base +
                " GROUP BY " + expr + " ORDER BY count DESC,value")]

        recent = "coalesce(nullif(" + expression("recency_at_ms") + ",0),nullif(" + expression("recency_at", "0") + ",0)*1000," \
                 "nullif(" + expression("updated_at_ms") + ",0),t.updated_at*1000)"
        created = "coalesce(nullif(" + expression("created_at_ms") + ",0),t.created_at*1000)"
        order = {"recent": recent, "created": created, "tokens": "t.tokens_used"}[sort]
        selection = ['t.id']
        selection += ["substr(" + expression(field, "''") + ",1," + str(limit) + ') AS "' + field + '"'
                      for field, limit in TEXT_FIELDS.items()]
        selection += [expression(field, "0") + ' AS "' + field + '"' for field in NUMBER_FIELDS]
        selection.append("substr(" + project_expr + ",1,160) AS project")
        edges = {row["name"] for row in connection.execute("PRAGMA table_info(thread_spawn_edges)")}
        if {"parent_thread_id", "child_thread_id"} <= edges:
            selection += [
                "(SELECT parent_thread_id FROM thread_spawn_edges WHERE child_thread_id=t.id LIMIT 1) AS parent_id",
                "(SELECT count(*) FROM thread_spawn_edges WHERE parent_thread_id=t.id) AS child_count"]
        rows = connection.execute("SELECT " + ",".join(selection) + base + where +
                                  " ORDER BY " + order + " DESC,t.id LIMIT ? OFFSET ?", params + [PAGE_SIZE, offset])
        items = []
        for row in rows:
            item = dict(row)
            item["startup_source"] = _startup_source(item["source"])
            # Source JSON can contain the parent relationship on older databases.
            if not item.get("parent_id"):
                try:
                    item["parent_id"] = json.loads(item["source"]).get("subagent", {}).get("thread_spawn", {}).get("parent_thread_id", "")
                except (ValueError, AttributeError, TypeError):
                    item["parent_id"] = ""
            item["child_count"] = item.get("child_count", 0)
            item["title"] = item["name"] or item["title"]
            item["preview"] = item["preview"] or item["first_user_message"]
            for field in TEXT_FIELDS.keys() | {"project", "startup_source"}:
                if field not in {"source", "thread_source", "agent_path"}:
                    item[field] = sanitize_content(item.get(field) or "")
            item.pop("cwd", None)
            item.pop("first_user_message", None)
            item["created_ms"] = _time(item, "created_at")
            item["updated_ms"] = _time(item, "updated_at")
            item["recent_ms"] = _time(item, "recency_at") or item["updated_ms"]
            # Only expose purpose and startup source, not the raw nested source payload.
            item.pop("source", None)
            items.append(item)
        return {"available": True, "status": "ready", "summary": summary, "filtered_summary": filtered,
                "facets": facets, "threads": items,
                "pagination": {"offset": offset, "limit": PAGE_SIZE, "total": filtered["threads"]}}


def register_thread_routes(app):
    @app.get("/api/codex-threads")
    def codex_threads():
        try:
            values = {key: request.args.get(key, "").strip() for key in
                      ("query", "source", "model", "project", "archived")}
            sort = request.args.get("sort", "recent")
            offset = int(request.args.get("offset", "0"))
            if any(len(value) > 200 for value in values.values()) or not 0 <= offset <= 1000000:
                raise ValueError("filters")
            if values["archived"] not in {"", "0", "1"} or sort not in {"recent", "created", "tokens"}:
                raise ValueError("filters")
            result = read_threads(**values, sort=sort, offset=offset)
            response = jsonify(ok=True, **result)
        except ValueError:
            response = jsonify(ok=False, error="invalid_filters")
            response.status_code = 400
        except (BoardUnavailable, sqlite3.Error, OSError):
            response = jsonify(ok=False, error="unavailable")
            response.status_code = 503
        response.headers["Cache-Control"] = "no-store"
        return response
