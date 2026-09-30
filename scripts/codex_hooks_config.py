#!/usr/bin/env python3
"""Print an absolute-path hooks.json; do not modify Codex configuration."""
from __future__ import annotations
import argparse
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from hook_events import HOOKS

def build_config(script=None, python=None):
    script = str(Path(script or ROOT / "codex_hook.py").resolve())
    interpreter = python or ("python" if os.name == "nt" else "python3")
    command = shlex.join([interpreter, script])
    windows = subprocess.list2cmdline([interpreter, script])
    hooks = {}
    for event in HOOKS:
        handler = {"type": "command", "command": command, "commandWindows": windows,
                   "timeout": 3, "statusMessage": "Star Office: " + event}
        if event == "PostToolUse":
            handler["async"] = True
        hooks[event] = [{"hooks": [handler]}]
    return {"description": "Star Office UI Codex lifecycle integration", "hooks": hooks}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", help="Interpreter command or absolute path")
    args = parser.parse_args()
    print(json.dumps(build_config(python=args.python), indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
