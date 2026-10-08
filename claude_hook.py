#!/usr/bin/env python3
"""Claude Code hook observer; never blocks or approves agent operations."""
import sys
from hook_observer import main

if __name__ == "__main__":
    sys.exit(main("claude_code"))
