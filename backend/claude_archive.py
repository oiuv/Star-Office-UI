"""Read-only statistics from retained Claude Code transcripts in the global directory."""
from __future__ import annotations

from collections import Counter
from datetime import datetime
import json
import os
from pathlib import Path
import re
import threading
from uuid import UUID

from flask import jsonify, request
from memo_utils import sanitize_content

PAGE_SIZE = 20
TOKEN_FIELDS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
_cache = {}
_lock = threading.Lock()


def _text(value, limit=160):
    return sanitize_content(value[:limit]) if isinstance(value, str) else ""


def _time(value):
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except (ValueError, TypeError, AttributeError, OverflowError, OSError):
        return 0


def _uuid(value):
    try:
        return str(UUID(value)) == value.lower()
    except (ValueError, TypeError, AttributeError):
        return False


def _files(root):
    """Only native main/agent transcripts; never follow project or file symlinks."""
    for project in sorted(root.iterdir()):
        if project.is_symlink() or not project.is_dir():
            continue
        for path in sorted(project.iterdir()):
            if path.is_symlink():
                continue
            if path.is_file() and path.suffix == ".jsonl" and (_uuid(path.stem) or path.stem.startswith("agent-")):
                yield path, "subagent" if path.stem.startswith("agent-") else "main", ""
            elif path.is_dir() and _uuid(path.name):
                agents = path / "subagents"
                if agents.is_symlink() or not agents.is_dir():
                    continue
                for agent in sorted(agents.glob("agent-*.jsonl")):
                    if agent.is_file() and not agent.is_symlink():
                        yield agent, "subagent", path.name


def _usage(value):
    if not isinstance(value, dict):
        return None
    result = {key: number for key in TOKEN_FIELDS
              if isinstance(number := value.get(key), int) and not isinstance(number, bool) and number >= 0}
    return result if result else None


def _merge(target, incoming):
    # Streamed content blocks repeat a message ID; zero placeholders must not erase final usage.
    for key, value in incoming.items():
        target[key] = max(target.get(key, 0), value)


def _parse(path, kind, parent):
    item = dict(id=path.stem, kind=kind, parent_id=parent, project="", title="", preview="",
                created_ms=0, updated_ms=0, branch="", version="", agent="", models=[],
                _messages={}, _tools={}, _prompts=set(), skipped_lines=0, unidentified_usage=0)
    with path.open("r", encoding="utf-8-sig", errors="replace") as stream:
        for index, line in enumerate(stream):
            try:
                record = json.loads(line)
            except ValueError:
                if line.strip():
                    item["skipped_lines"] += 1
                continue
            if not isinstance(record, dict):
                item["skipped_lines"] += 1
                continue
            timestamp = _time(record.get("timestamp"))
            if timestamp:
                item["created_ms"] = min(item["created_ms"] or timestamp, timestamp)
                item["updated_ms"] = max(item["updated_ms"], timestamp)
            cwd = record.get("cwd")
            if isinstance(cwd, str) and cwd:
                item["project"] = _text(re.split(r"[\\/]", cwd.rstrip("/\\"))[-1])
            for key, source in (("branch", "gitBranch"), ("version", "version"), ("agent", "agentName")):
                if record.get(source):
                    item[key] = _text(record[source])
            if record.get("type") == "ai-title" and record.get("aiTitle"):
                item["title"] = _text(record["aiTitle"], 240)
            if kind == "subagent" and not parent and _uuid(record.get("sessionId", "")):
                item["parent_id"] = record["sessionId"]
            message = record.get("message")
            if not isinstance(message, dict):
                continue
            content = message.get("content", [])
            blocks = content if isinstance(content, list) else []
            if record.get("type") == "user" and not record.get("isMeta") and not record.get("isCompactSummary"):
                # Tool results and injected control messages are not user prompts.
                if not any(isinstance(block, dict) and block.get("type") == "tool_result" for block in blocks):
                    texts = [block["text"] for block in blocks if isinstance(block, dict)
                             and block.get("type") == "text" and isinstance(block.get("text"), str)]
                    text = content if isinstance(content, str) else "\n".join(texts)
                    if text.strip():
                        identity = record.get("uuid") or f"{path}:{index}"
                        item["_prompts"].add(str(identity))
                        if not item["preview"]:
                            item["preview"] = sanitize_content(text.strip())
            if record.get("type") != "assistant" or message.get("model") == "<synthetic>":
                continue
            model = _text(message.get("model"))
            identity = message.get("id")
            if not isinstance(identity, str) or not identity:
                identity = "record:" + str(record.get("uuid") or f"{path}:{index}")
                if _usage(message.get("usage")) is not None:
                    item["unidentified_usage"] += 1
            entry = item["_messages"].setdefault(identity, {"model": model, "usage": {}})
            if model:
                entry["model"] = model
            usage = _usage(message.get("usage"))
            if usage is not None:
                _merge(entry["usage"], usage)
            for block in blocks:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                tool_id, name = block.get("id"), _text(block.get("name"))
                if isinstance(tool_id, str) and tool_id and name:
                    item["_tools"][tool_id] = name
    item["project"] = item["project"] or _text(path.parent.name if kind == "main" or not parent else path.parents[2].name)
    item["title"] = item["title"] or item["agent"] or " ".join(item["preview"].split())[:240]
    summary = _summary([item])
    item.update(usage=summary["usage"], tokens=summary["tokens"], tool_calls=summary["tool_calls"],
                prompts=len(item["_prompts"]), replies=summary["replies"], usage_replies=summary["usage_replies"],
                tools=summary["tools"], models=[row["value"] for row in summary["models"]])
    return item


def _summary(items):
    messages, tools = {}, {}
    for item in items:
        for identity, entry in item["_messages"].items():
            target = messages.setdefault(identity, {"model": entry["model"], "usage": {}})
            _merge(target["usage"], entry["usage"])
            if entry["model"]:
                target["model"] = entry["model"]
        tools.update(item["_tools"])
    usage = {key: 0 for key in TOKEN_FIELDS}
    model_tokens, model_replies = Counter(), Counter()
    for entry in messages.values():
        for key, value in entry["usage"].items():
            usage[key] += value
        if entry["model"]:
            model_tokens[entry["model"]] += sum(entry["usage"].values())
            model_replies[entry["model"]] += 1
    denominator = usage["input_tokens"] + usage["cache_read_input_tokens"] + usage["cache_creation_input_tokens"]
    return dict(sessions=sum(item["kind"] == "main" for item in items),
                subagents=sum(item["kind"] == "subagent" for item in items), usage=usage,
                tokens=sum(usage.values()), replies=len(messages), usage_replies=sum(bool(entry["usage"]) for entry in messages.values()),
                tool_calls=len(tools), tools=[{"value": name, "count": count} for name, count in Counter(tools.values()).most_common()],
                models=[{"value": name, "count": model_replies[name], "tokens": tokens}
                        for name, tokens in model_tokens.most_common()],
                cache_read_share=usage["cache_read_input_tokens"] / denominator if denominator else None)


def read_claude_sessions(query="", kind="", model="", project="", sort="recent", offset=0):
    root = Path(os.environ.get("CLAUDE_CONFIG_DIR", "").strip() or Path.home() / ".claude").expanduser() / "projects"
    with _lock:
        items, seen, unreadable = [], set(), 0
        available = root.is_dir()
        if available:
            for path, category, parent in _files(root):
                seen.add(path)
                try:
                    stat = path.stat()
                    signature = (stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size)
                    cached = _cache.get(path)
                    if cached is None or cached[0] != signature:
                        parsed = _parse(path, category, parent)
                        # Do not cache a snapshot if a running session changed while it was read.
                        after = path.stat()
                        if (after.st_mtime_ns, after.st_ctime_ns, after.st_size) == signature:
                            _cache[path] = signature, parsed
                    else:
                        parsed = cached[1]
                    items.append(parsed)
                except OSError:
                    _cache.pop(path, None)
                    unreadable += 1
        for path in list(_cache):
            if path not in seen:
                del _cache[path]
        selected = [item for item in items if (not kind or item["kind"] == kind)
                    and (not model or model in item["models"]) and (not project or item["project"] == project)
                    and (not query or query.casefold() in " ".join((item["id"], item["title"], item["preview"], item["agent"])).casefold())]
        summary, filtered = _summary(items), _summary(selected)
        order = {"recent": "updated_ms", "created": "created_ms", "tokens": "tokens", "tools": "tool_calls"}[sort]
        selected.sort(key=lambda item: (item[order], item["id"]), reverse=True)
        facets = {}
        for key, field in (("projects", "project"), ("kinds", "kind")):
            facets[key] = [{"value": name, "count": count} for name, count in Counter(item[field] for item in items).most_common()]
        facets["models"] = [{"value": name, "count": count} for name, count in Counter(name for item in items for name in item["models"]).most_common()]
        return dict(available=available, status="ready" if available else "missing", summary=summary, filtered_summary=filtered,
                    facets=facets, sessions=[{key: value for key, value in item.items() if not key.startswith("_")}
                                            for item in selected[offset:offset + PAGE_SIZE]],
                    coverage={"skipped_lines": sum(item["skipped_lines"] for item in items), "unreadable_files": unreadable,
                              "unidentified_usage": sum(item["unidentified_usage"] for item in items)},
                    pagination={"offset": offset, "limit": PAGE_SIZE, "total": len(selected)})


def register_claude_archive_routes(app):
    @app.get("/api/claude-sessions")
    def claude_sessions():
        try:
            values = {key: request.args.get(key, "").strip() for key in ("query", "kind", "model", "project")}
            offset, sort = int(request.args.get("offset", "0")), request.args.get("sort", "recent")
            if any(len(value) > 200 for value in values.values()) or not 0 <= offset <= 1000000:
                raise ValueError("filters")
            if values["kind"] not in {"", "main", "subagent"} or sort not in {"recent", "created", "tokens", "tools"}:
                raise ValueError("filters")
            response = jsonify(ok=True, **read_claude_sessions(**values, offset=offset, sort=sort))
        except ValueError:
            response = jsonify(ok=False, error="invalid_filters")
            response.status_code = 400
        except OSError:
            response = jsonify(ok=False, error="unavailable")
            response.status_code = 503
        response.headers["Cache-Control"] = "no-store"
        return response
