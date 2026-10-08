#!/usr/bin/env python3
"""Print an absolute-path hooks.json; do not modify Codex configuration."""
from __future__ import annotations
import argparse
import json
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from hook_events import HOOKS

# Human-readable messages shown by Codex while the observer runs.
STATUS_MESSAGES = {
    "SessionStart": "初始化",
    "SessionEnd": "收尾",
    "UserPromptSubmit": "接收任务",
    "PreToolUse": "执行中",
    "PermissionRequest": "请求权限",
    "PostToolUse": "处理工具结果",
    "PreCompact": "保存上下文",
    "PostCompact": "恢复工作",
    "SubagentStart": "Agent 工作中",
    "SubagentStop": "Agent 收尾",
    "Stop": "待命",
    "Interrupt": "已中断"
}

def build_config(script=None, python=None):
    script = str(Path(script or ROOT / "codex_hook.py").resolve())
    interpreter = python or sys.executable
    command = shlex.join([interpreter.replace("\\", "/"), "-B", script.replace("\\", "/")])
    windows = subprocess.list2cmdline([interpreter, "-B", script])
    hooks = {}
    for event in HOOKS:
        handler = {"type": "command", "command": command, "commandWindows": windows,
                   "timeout": 3, "statusMessage": "STAR OFFICE: " + STATUS_MESSAGES[event]}
        hooks[event] = [{"hooks": [handler]}]
    return {"description": "STAR OFFICE Codex lifecycle integration", "hooks": hooks}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", help="Interpreter command or absolute path (default: current Python executable)")
    args = parser.parse_args()
    # Keep Chinese labels valid UTF-8 when stdout is redirected on Windows.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(build_config(python=args.python), indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
