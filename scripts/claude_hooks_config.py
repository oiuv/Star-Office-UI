#!/usr/bin/env python3
"""Print hooks to merge into Claude Code settings; never modify user settings."""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from hook_events import CLAUDE_OBSERVER_HOOKS, CLAUDE_ASYNC_HOOKS

def build_config(script=None, python=None, watch_files=None):
    script = str(Path(script or ROOT / "claude_hook.py").resolve())
    interpreter = python or sys.executable
    # Exec form avoids Bash/PowerShell quoting differences on Windows.
    # Key lifecycle events stay synchronous for complete turn accounting.
    hooks = {}
    for event in CLAUDE_OBSERVER_HOOKS:
        handler = {"type": "command", "command": interpreter, "args": ["-B", script], "timeout": 3}
        if event in CLAUDE_ASYNC_HOOKS:
            handler["async"] = True
        hooks[event] = [{"hooks": [handler]}]
    config = {"hooks": hooks}
    if watch_files:
        if any(not name or any(c in name for c in "/\\|*") for name in watch_files):
            raise ValueError("--watch-file must be a literal filename, without paths or wildcards")
        config["hooks"]["FileChanged"][0]["matcher"] = "|".join(watch_files)
    return config

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", help="Interpreter command or absolute path (default: current Python executable)")
    parser.add_argument("--watch-file", action="append", help="Literal filename to watch; repeat for multiple files")
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(build_config(python=args.python, watch_files=args.watch_file), indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
