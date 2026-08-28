# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Unit + end-to-end tests for the telegram-reply-guard Claude hook family."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _telegram_reply_guard as guard

HOOKS_DIR = Path(__file__).parent
MARK_HOOK = str(HOOKS_DIR / "telegram-reply-guard-mark.py")
CLEAR_HOOK = str(HOOKS_DIR / "telegram-reply-guard-clear.py")
STOP_HOOK = str(HOOKS_DIR / "telegram-reply-guard-stop.py")

REAL_TAG = (
    '<channel source="plugin:telegram:telegram" chat_id="123" '
    'message_id="1" user="alice" ts="0">hi</channel>'
)


def _run(hook_path: str, payload: dict) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, hook_path],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        check=False,
    )


class TestExtractChatId:
    def test_matches_real_channel_tag(self) -> None:
        assert guard.extract_chat_id(REAL_TAG) == "123"

    def test_ignores_plain_text(self) -> None:
        assert guard.extract_chat_id("just a normal prompt") is None

    def test_ignores_other_channel_sources(self) -> None:
        other = '<channel source="plugin:slack:slack" chat_id="456">hi</channel>'
        assert guard.extract_chat_id(other) is None


class TestMarkHook:
    SESSION_ID = "test-mark-session"

    def teardown_method(self) -> None:
        guard.clear_pending(self.SESSION_ID)

    def test_marks_pending_on_telegram_message(self) -> None:
        r = _run(MARK_HOOK, {"session_id": self.SESSION_ID, "prompt": REAL_TAG})
        assert r.returncode == 0
        assert r.stdout == ""
        assert guard.read_pending(self.SESSION_ID) == "123"

    def test_no_marker_for_plain_prompt(self) -> None:
        r = _run(MARK_HOOK, {"session_id": self.SESSION_ID, "prompt": "hello there"})
        assert r.returncode == 0
        assert guard.read_pending(self.SESSION_ID) is None

    def test_missing_session_id_is_noop(self) -> None:
        r = _run(MARK_HOOK, {"prompt": REAL_TAG})
        assert r.returncode == 0
        assert r.stdout == ""

    def test_invalid_json(self) -> None:
        r = subprocess.run(
            [sys.executable, MARK_HOOK],
            input="not json",
            capture_output=True,
            text=True,
            check=False,
        )
        assert r.returncode == 0
        assert r.stdout == ""


class TestClearHook:
    SESSION_ID = "test-clear-session"

    def teardown_method(self) -> None:
        guard.clear_pending(self.SESSION_ID)

    def test_clears_existing_marker(self) -> None:
        guard.mark_pending(self.SESSION_ID, "999")
        r = _run(CLEAR_HOOK, {"session_id": self.SESSION_ID})
        assert r.returncode == 0
        assert r.stdout == ""
        assert guard.read_pending(self.SESSION_ID) is None

    def test_no_marker_present_is_noop(self) -> None:
        r = _run(CLEAR_HOOK, {"session_id": self.SESSION_ID})
        assert r.returncode == 0
        assert r.stdout == ""

    def test_missing_session_id_is_noop(self) -> None:
        r = _run(CLEAR_HOOK, {})
        assert r.returncode == 0
        assert r.stdout == ""


class TestStopHook:
    SESSION_ID = "test-stop-session"

    def teardown_method(self) -> None:
        guard.clear_pending(self.SESSION_ID)

    def test_blocks_when_reply_pending(self) -> None:
        guard.mark_pending(self.SESSION_ID, "42")
        r = _run(STOP_HOOK, {"session_id": self.SESSION_ID, "stop_hook_active": False})
        assert r.returncode == 0
        out = json.loads(r.stdout)
        assert out["decision"] == "block"
        assert "42" in out["reason"]
        assert guard.REPLY_TOOL in out["reason"]

    def test_silent_when_no_marker(self) -> None:
        r = _run(STOP_HOOK, {"session_id": self.SESSION_ID, "stop_hook_active": False})
        assert r.returncode == 0
        assert r.stdout == ""

    def test_silent_when_stop_hook_active_even_with_marker(self) -> None:
        guard.mark_pending(self.SESSION_ID, "42")
        r = _run(STOP_HOOK, {"session_id": self.SESSION_ID, "stop_hook_active": True})
        assert r.returncode == 0
        assert r.stdout == ""

    def test_missing_session_id_is_noop(self) -> None:
        r = _run(STOP_HOOK, {"stop_hook_active": False})
        assert r.returncode == 0
        assert r.stdout == ""

    def test_invalid_json(self) -> None:
        r = subprocess.run(
            [sys.executable, STOP_HOOK],
            input="not json",
            capture_output=True,
            text=True,
            check=False,
        )
        assert r.returncode == 0
        assert r.stdout == ""
