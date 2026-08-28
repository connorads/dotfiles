#!/usr/bin/env python3
"""
Claude Code UserPromptSubmit hook: mark a Telegram-channel message as owed a
reply, so telegram-reply-guard-stop.py can block a plain-text answer that
never reaches Telegram.

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
    prompt = input_data.get("prompt", "")
    if not session_id or not prompt:
        return 0

    chat_id = guard.extract_chat_id(prompt)
    if chat_id:
        guard.mark_pending(session_id, chat_id)

    return 0


if __name__ == "__main__":
    sys.exit(main())
