"""Regression tests for Rust/Python parity fixes.

Each test pins a divergence found during a parity review of the port against the Rust
reference. Grouped by the module the fix landed in.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import pytest

from handoff._ids import is_uuid, normalize_uuid
from handoff._json import timestamp_millis
from handoff.errors import HandoffError
from handoff.formats import codex
from handoff.formats import claude
from handoff.ir import (
    SessionFormat,
    ToolCallEvent,
    UniversalSession,
)


# --- _ids: strict UUID parsing (Uuid::parse_str) -----------------------------------


def test_is_uuid_rejects_mishyphenated_strings() -> None:
    """Rust `Uuid::parse_str` rejects hyphens outside 8/13/18/23; stdlib accepts them."""
    assert not is_uuid("67e5-5044-10b1-426f-9247-bb680e5fe0c8")
    assert not is_uuid("d89e-26cd11f247e8bea5a73ad5458483")
    assert not is_uuid("01-23-45-67-89ab-cdef-0123-456789abcdef")
    assert normalize_uuid("67e5-5044-10b1-426f-9247-bb680e5fe0c8") is None


def test_is_uuid_accepts_canonical_and_crate_forms() -> None:
    """The four forms `Uuid::parse_str` accepts: simple, hyphenated, braced, urn."""
    canonical = "d89e26cd-11f2-47e8-bea5-a73ad5458483"
    assert is_uuid(canonical)
    assert is_uuid("d89e26cd11f247e8bea5a73ad5458483")  # simple
    assert is_uuid("{d89e26cd-11f2-47e8-bea5-a73ad5458483}")  # braced
    assert is_uuid("urn:uuid:d89e26cd-11f2-47e8-bea5-a73ad5458483")  # urn
    # Normalisation lowercases and hyphenates, like the crate's Display.
    assert normalize_uuid("D89E26CD-11F2-47E8-BEA5-A73AD5458483") == canonical
    assert normalize_uuid("d89e26cd11f247e8bea5a73ad5458483") == canonical


# --- _json: exact millisecond timestamp (timestamp_millis) -------------------------


def test_timestamp_millis_is_exact() -> None:
    """`timestamp_millis` matches chrono; `int(ts*1000)` would land 1ms low here."""
    dt = datetime(2004, 6, 21, 21, 40, 18, 485000, tzinfo=UTC)
    assert timestamp_millis(dt) == 1087854018485
    assert int(dt.timestamp() * 1000) == 1087854018484  # the float-multiply bug


# --- claude: caller: null round-trips (presence, not not-None) ---------------------


def test_claude_load_preserves_explicit_null_caller(tmp_path: Path) -> None:
    """A tool_use block with `caller: null` yields metadata {"caller": null}."""
    line = {
        "type": "assistant",
        "uuid": "u1",
        "parentUuid": None,
        "sessionId": "d89e26cd-11f2-47e8-bea5-a73ad5458483",
        "message": {
            "role": "assistant",
            "content": [
                {"type": "tool_use", "id": "t1", "name": "Bash", "input": {}, "caller": None}
            ],
        },
    }
    path = tmp_path / "session.jsonl"
    path.write_text(json.dumps(line) + "\n", encoding="utf-8")

    session = claude.load(path)
    calls = [event for event in session.events if isinstance(event, ToolCallEvent)]
    assert len(calls) == 1
    assert calls[0].metadata == {"caller": None}


# --- codex: split on "\n" only, not str.splitlines() -------------------------------


def test_codex_load_keeps_unicode_line_separators_intact(tmp_path: Path) -> None:
    """A raw U+2028 inside a JSONL string must not fragment the line."""
    meta = {
        "timestamp": "2023-01-01T00:00:00.000Z",
        "type": "session_meta",
        "payload": {
            "id": "019cd6bd-10df-7e61-8506-e9ac5bdf4e6e",
            "timestamp": "2023-01-01T00:00:00.000Z",
            "cwd": "/x",
        },
    }
    message = {
        "timestamp": "2023-01-01T00:00:01.000Z",
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": "para1 para2"}],
        },
    }
    path = tmp_path / "rollout.jsonl"
    # ensure_ascii=False emits U+2028 raw, exactly as serde_json/the Rust writer would.
    path.write_text(
        json.dumps(meta, ensure_ascii=False)
        + "\n"
        + json.dumps(message, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
    # Exactly two logical lines, separated only by "\n".
    assert path.read_text(encoding="utf-8").count("\n") == 2

    session = codex.load(path)
    texts = [
        block.text
        for event in session.events
        for block in getattr(event, "blocks", [])
    ]
    assert "para1 para2" in texts


# --- codex: empty-string metadata preserved (unwrap_or_else vs `or`) ----------------


def test_codex_write_preserves_empty_originator(tmp_path: Path) -> None:
    """An empty `codex_originator` is preserved, not defaulted to "handoff"."""
    session = UniversalSession.new("019cd6bd-10df-7e61-8506-e9ac5bdf4e6e")
    session.metadata.source_format = SessionFormat.CODEX
    session.metadata.extra["codex_originator"] = ""

    output = tmp_path / "rollout.jsonl"
    codex.write(session, output)

    first_line = output.read_text(encoding="utf-8").splitlines()[0]
    payload = json.loads(first_line)["payload"]
    assert payload["originator"] == ""


def test_codex_write_preserves_empty_approval_policy(tmp_path: Path) -> None:
    """An empty `codex_approval_policy` is stored verbatim in threads.approval_mode."""
    sqlite_path = tmp_path / "state_5.sqlite"
    connection = sqlite3.connect(str(sqlite_path))
    try:
        connection.executescript(
            """CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                rollout_path TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                source TEXT NOT NULL,
                model_provider TEXT NOT NULL,
                cwd TEXT NOT NULL,
                title TEXT NOT NULL,
                sandbox_policy TEXT NOT NULL,
                approval_mode TEXT NOT NULL,
                tokens_used INTEGER NOT NULL DEFAULT 0,
                has_user_event INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                archived_at INTEGER,
                git_sha TEXT,
                git_branch TEXT,
                git_origin_url TEXT,
                cli_version TEXT NOT NULL DEFAULT '',
                first_user_message TEXT NOT NULL DEFAULT '',
                agent_nickname TEXT,
                agent_role TEXT,
                memory_mode TEXT NOT NULL DEFAULT 'enabled'
            );"""
        )
        connection.commit()

        session = UniversalSession.new("019cd6bd-10df-7e61-8506-e9ac5bdf4e6e")
        session.metadata.source_format = SessionFormat.CODEX
        session.metadata.extra["codex_approval_policy"] = ""

        codex.write(session, tmp_path)

        approval_mode = connection.execute(
            "SELECT approval_mode FROM threads LIMIT 1"
        ).fetchone()[0]
        assert approval_mode == ""
    finally:
        connection.close()


# --- ir: required fields reject (serde has no #[serde(default)]) --------------------


def _ir(events: list[dict[str, object]]) -> dict[str, object]:
    return {
        "ir_version": "handoff/v1",
        "metadata": {"session_id": "s"},
        "events": events,
    }


@pytest.mark.parametrize(
    "event",
    [
        {"kind": "message", "role": "user"},  # no blocks
        {"kind": "reasoning"},  # no summary
        {"kind": "tool_call", "call_id": "c", "name": "n"},  # no arguments
        {"kind": "tool_result", "call_id": "c", "is_error": False},  # no output
        {"kind": "tool_result", "call_id": "c", "output": None},  # no is_error
    ],
)
def test_ir_rejects_events_missing_required_fields(event: dict[str, object]) -> None:
    """Rust `serde_json::from_str` aborts on a missing required field; so must we."""
    with pytest.raises(HandoffError):
        UniversalSession.from_json_dict(_ir([event]))


def test_ir_rejects_missing_events() -> None:
    """`events` has no serde default, so an IR without it is rejected."""
    with pytest.raises(HandoffError):
        UniversalSession.from_json_dict(
            {"ir_version": "handoff/v1", "metadata": {"session_id": "s"}}
        )


# --- cli: no long-flag abbreviation; version parity --------------------------------


def test_cli_rejects_abbreviated_long_flags(
    run_cli: Callable[..., object],
) -> None:
    """clap has no long-arg inference; argparse must not resolve `--out` -> `--output`."""
    result = run_cli("--to", "codex", "--out", "/tmp/x.jsonl", "SID")
    assert result.returncode == 2


def test_cli_version_matches_reference(run_cli: Callable[..., object]) -> None:
    """`--version` prints the package version."""
    result = run_cli("--version")
    assert result.returncode == 0
    assert result.stdout.strip() == "handoff 0.1.3"
