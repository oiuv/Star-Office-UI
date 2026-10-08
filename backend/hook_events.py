"""Map supported agent lifecycle events to six animation states without retaining raw inputs."""
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

PROVIDERS = {"codex": "Codex", "claude_code": "Claude Code"}
CLAUDE_HOOKS = (
    "SessionStart", "Setup", "UserPromptSubmit",
    "UserPromptExpansion", "PreToolUse", "PermissionRequest",
    "PermissionDenied", "PostToolUse", "PostToolUseFailure",
    "PostToolBatch", "Notification", "MessageDisplay",
    "SubagentStart", "SubagentStop", "TaskCreated",
    "TaskCompleted", "Stop", "StopFailure",
    "TeammateIdle", "InstructionsLoaded", "ConfigChange",
    "CwdChanged", "DirectoryAdded", "FileChanged",
    "WorktreeCreate", "WorktreeRemove", "PreCompact",
    "PostCompact", "PreModelSwitch", "PostModelSwitch",
    "Elicitation", "ElicitationResult", "SessionEnd",
)
# WorktreeCreate replaces creation; observe it from a custom creator, never install it blindly.
CLAUDE_OBSERVER_HOOKS = tuple(name for name in CLAUDE_HOOKS if name != "WorktreeCreate")
CLAUDE_ASYNC_HOOKS = frozenset(name for name in CLAUDE_OBSERVER_HOOKS
                               if name not in HOOKS and name not in {"PostToolUseFailure", "StopFailure"})
SHARED_HOOKS = tuple(name for name in HOOKS if name in CLAUDE_HOOKS)
ALL_HOOKS = tuple(dict.fromkeys((*HOOKS, *CLAUDE_HOOKS)))

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

def normalize_hook(payload, provider="codex"):
    if not isinstance(payload, dict):
        raise ValueError("Hook payload must be a JSON object")
    if provider not in PROVIDERS:
        raise ValueError("Unsupported hook provider")
    original_name = payload.get("hook_event_name")
    supported = CLAUDE_HOOKS if provider == "claude_code" else HOOKS
    if original_name not in supported:
        raise ValueError("Unsupported hook_event_name")
    name = {"PostToolUseFailure": "PostToolUse", "StopFailure": "Stop"}.get(original_name, original_name)
    session = short_text(payload.get("session_id"), 200)
    if not session:
        raise ValueError("session_id is required")
    agent = short_text(payload.get("agent_id"), 200)
    turn = short_text(payload.get("prompt_id") if provider == "claude_code" else payload.get("turn_id"), 200)
    tool = short_text(payload.get("tool_name"), 100)
    tool_id = short_text(payload.get("tool_use_id"), 200)
    actor = provider + "_" + hashlib.sha256((session + ":" + agent).encode()).hexdigest()[:16]
    failed = original_name in {"PostToolUseFailure", "StopFailure"} or (name == "PostToolUse" and (
        payload.get("tool_failed") is True or tool_failed(payload.get("tool_response"))
    ))
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
    }.get(name, ("idle", "已记录 " + original_name))
    if original_name == "StopFailure":
        state, detail = "error", "本轮响应失败"
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
    if provider == "claude_code":
        metadata["original_event_name"] = original_name
        metadata["observe_only"] = name not in HOOKS
        for key in ("notification_type", "event", "from_model", "to_model", "task_id", "mcp_server_name", "action", "reason", "message_id"):
            value = short_text(payload.get(key), 100)
            if value:
                metadata[key] = value
        if original_name == "MessageDisplay":
            if isinstance(payload.get("index"), int) and not isinstance(payload["index"], bool):
                metadata["index"] = payload["index"]
            metadata["final"] = payload.get("final") is True
    metadata["stop_hook_active"] = payload.get("stop_hook_active") is True
    event_id = short_text(payload.get("event_id"), 200)
    if provider == "claude_code":
        # Native IDs are stable across retries; isolate explicit IDs by provider too.
        identity = tool_id if name in {"PreToolUse", "PostToolUse", "PermissionRequest"} else (
            turn if name in {"UserPromptSubmit", "Stop", "SubagentStart", "SubagentStop"} else ""
        )
        if original_name == "MessageDisplay" and metadata.get("message_id") and "index" in metadata:
            identity = f"{metadata['message_id']}:{metadata['index']}"
        if identity or event_id:
            key = f"{actor}:{original_name}:{identity}" if identity else f"{provider}:{event_id}"
            event_id = hashlib.sha256(key.encode()).hexdigest()
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
        "event_id": event_id, "source": provider, "event_name": name,
        "actor_id": actor, "actor_name": (("Agent " if agent else "Codex ") if provider == "codex" else "Claude Code " + ("Agent " if agent else "")) + (agent or session)[-8:],
        "session_id": session, "turn_id": turn, "tool_id": tool_id,
        "tool_name": tool, "state": state, "detail": detail,
        "occurred_at": float(timestamp), "outcome": "error" if failed else "ok",
        "metadata": metadata,
    }
