#!/usr/bin/env python3
"""Compatibility entry point for the Codex hook observer."""
import sys
from hook_observer import forwardable_event, main

if __name__ == "__main__":
    sys.exit(main())
