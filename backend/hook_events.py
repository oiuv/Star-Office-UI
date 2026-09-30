"""Map Codex lifecycle events to six animation states without retaining raw inputs."""
from __future__ import annotations
import hashlib
import time
import uuid

STATES = ("idle", "writing", "researching", "executing", "syncing", "error")
HOOKS = (
    "PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact",
    "SessionStart", "SessionEnd", "UserPromptSubmit", "SubagentStart",
    "SubagentStop", "Stop", "Interrupt",
)

def short_text(value, limit=160):
    return " ".join(value.split())[:limit] if isinstance(value, str) else ""

def tool_state(tool_name):
    name = tool_name.lower()
    if any(w in name for w in ("apply_patch", "write", "edit")):
        return "writing"
    if any(w in name for w in ("search", "web", "browser", "fetch", "research", "read", "find")):
        return "researching"
    return "executing"

def tool_failed(response):
    if not isinstance(response, dict):
        return False
    if response.get("isError") is True or response.get("is_error") is True:
        return True
    code = response.get("exit_code", response.get("exitCode"))
    if isinstance(code, int) and not isinstance(code, bool) and code != 0:
        return True
    return tool_failed(response.get("structuredContent"))

def normalize_hook(payload):
    if not isinstance(payload, dict):
        raise ValueError("Hook payload must be a JSON object")
    name = payload.get("hook_event_name")
    if name not in HOOKS:
        raise ValueError("Unsupported hook_event_name")
    session = short_text(payload.get("session_id"), 200)
    if not session:
        raise ValueError("session_id is required")
    agent = short_text(payload.get("agent_id"), 200)
    turn = short_text(payload.get("turn_id"), 200)
    tool = short_text(payload.get("tool_name"), 100)
    tool_id = short_text(payload.get("tool_use_id"), 200)
    actor = "codex_" + hashlib.sha256((session + ":" + agent).encode()).hexdigest()[:16]
    failed = name == "PostToolUse" and (
        payload.get("tool_failed") is True or tool_failed(payload.get("tool_response"))
    )
    state, detail = {
        "SessionStart": ("idle", "会话开始，待命中"),
        "SessionEnd": ("idle", "会话已结束"),
        "UserPromptSubmit": ("researching", "正在理解新任务"),
        "PermissionRequest": ("idle", "等待执行权限"),
        "PreCompact": ("syncing", "正在整理上下文"),
        "PostCompact": ("executing", "上下文整理完成，继续工作"),
        "SubagentStart": ("executing", "子 Agent 开始工作"),
        "SubagentStop": ("idle", "子 Agent 本轮已结束"),
        "Stop": ("idle", "本轮已结束，待命中"),
        "Interrupt": ("idle", "已中断，待命中"),
        "PreToolUse": (tool_state(tool), "正在使用工具"),
        "PostToolUse": ("error" if failed else "executing", "工具执行失败" if failed else "正在处理工具结果"),
    }[name]
    if tool and name in {"PreToolUse", "PostToolUse", "PermissionRequest"}:
        detail += " · " + tool
    if name == "SessionStart" and payload.get("source") == "compact":
        state, detail = "executing", "上下文压缩后继续工作"
    elif name == "SessionStart" and payload.get("source") == "resume":
        detail = "恢复会话，待命中"
    if name == "PreCompact" and payload.get("trigger") == "auto":
        detail = "正在自动整理上下文"
    metadata = {
        k: short_text(payload.get(k), 100)
        for k in ("source", "trigger", "model", "agent_type", "permission_mode")
        if isinstance(payload.get(k), str)
    }
    metadata["is_subagent"] = bool(agent)
    metadata["stop_hook_active"] = payload.get("stop_hook_active") is True
    event_id = short_text(payload.get("event_id"), 200)
    if not event_id and tool_id and name in {"PreToolUse", "PostToolUse", "PermissionRequest"}:
        event_id = hashlib.sha256(f"{actor}:{name}:{turn}:{tool_id}".encode()).hexdigest()
    if not event_id:
        event_id = str(uuid.uuid4())
    timestamp = payload.get("occurred_at", time.time())
    if not isinstance(timestamp, (int, float)) or isinstance(timestamp, bool):
        raise ValueError("occurred_at must be a Unix timestamp")
    if not 0 < timestamp <= time.time() + 60:
        raise ValueError("occurred_at is outside the accepted range")
    return {
        "event_id": event_id, "source": "codex", "event_name": name,
        "actor_id": actor, "actor_name": ("Agent " if agent else "Codex ") + (agent or session)[-8:],
        "session_id": session, "turn_id": turn, "tool_id": tool_id,
        "tool_name": tool, "state": state, "detail": detail,
        "occurred_at": float(timestamp), "outcome": "error" if failed else "ok",
        "metadata": metadata,
    }
