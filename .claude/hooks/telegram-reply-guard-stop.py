#!/usr/bin/env python3
"""
Claude Code Stop hook: block ending the turn while a Telegram-channel message
is still owed a reply via mcp__plugin_telegram_telegram__reply. The Telegram
plugin's own instructions say plain transcript output never reaches the
sender's chat - this makes that a mechanical guarantee instead of a prompt to
remember.

Checks stop_hook_active first and returns silently if true, per the
documented Stop-hook-loop-avoidance contract.

Exit codes:
  0 - Always

Output:
  JSON with decision "block" (+ reason) when a reply is still pending, else
  nothing.

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

    if input_data.get("stop_hook_active"):
        return 0

    session_id = input_data.get("session_id")
    if not session_id:
        return 0

    chat_id = guard.read_pending(session_id)
    if chat_id:
        json.dump(
            {
                "decision": "block",
                "reason": (
                    f"You have not replied on Telegram yet (chat_id {chat_id}). "
                    f"Call {guard.REPLY_TOOL} before finishing this turn - plain "
                    "text output never reaches the user there."
                ),
            },
            sys.stdout,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
