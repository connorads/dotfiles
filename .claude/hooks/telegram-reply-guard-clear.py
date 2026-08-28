#!/usr/bin/env python3
"""
Claude Code PostToolUse (mcp__plugin_telegram_telegram__reply matcher) and
SessionEnd hook: clear the pending Telegram-reply marker for this session -
once when the reply tool actually fires, once as an abandoned-session sweep.

Exit codes:
  0 - Always

Tests: uv run --with pytest pytest ~/.claude/hooks/test_telegram_reply_guard.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _telegram_reply_guard as guard


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    session_id = input_data.get("session_id")
    if session_id:
        guard.clear_pending(session_id)

    return 0


if __name__ == "__main__":
    sys.exit(main())
