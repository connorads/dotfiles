"""Shared helpers for the telegram-reply-guard hook family.

State: one text file per session under state/telegram-reply-pending/<session_id>,
containing the chat_id owed a reply. Presence means a Telegram-channel message
arrived and mcp__plugin_telegram_telegram__reply hasn't fired since.
"""

from __future__ import annotations

import re
from pathlib import Path

CHANNEL_SOURCE = "plugin:telegram:telegram"
REPLY_TOOL = "mcp__plugin_telegram_telegram__reply"
PENDING_DIR = Path(__file__).parent / "state" / "telegram-reply-pending"

_CHANNEL_RE = re.compile(
    r'<channel\s+source="' + re.escape(CHANNEL_SOURCE) + r'"[^>]*\bchat_id="(?P<chat_id>[^"]+)"'
)


def extract_chat_id(prompt: str) -> str | None:
    match = _CHANNEL_RE.search(prompt)
    return match.group("chat_id") if match else None


def _pending_path(session_id: str) -> Path:
    return PENDING_DIR / session_id


def mark_pending(session_id: str, chat_id: str) -> None:
    PENDING_DIR.mkdir(parents=True, exist_ok=True)
    _pending_path(session_id).write_text(chat_id)


def read_pending(session_id: str) -> str | None:
    try:
        return _pending_path(session_id).read_text().strip() or None
    except FileNotFoundError:
        return None


def clear_pending(session_id: str) -> None:
    _pending_path(session_id).unlink(missing_ok=True)
