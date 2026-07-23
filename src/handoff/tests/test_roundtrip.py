"""Materialisation / round-trip tests.

Ported from `tests/roundtrip.rs`:

- `materializes_canonical_codex_layout`
- `materialized_codex_sessions_include_turn_events`
- `materializes_canonical_claude_layout`
- `writes_ir_json`
- `projects_codex_developer_messages_into_claude`

Plus one clearly-labelled safety-net addition the Rust suite lacks
(`test_ir_roundtrip_reload_addition`).

The Rust tests drive `rusqlite::Connection`; the Python port uses the stdlib
`sqlite3` module against the same on-disk `state_5.sqlite` file.
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter
from collections.abc import Callable
from pathlib import Path

from handoff.formats import load_ir, load_session, materialize
from handoff.ir import (
    ContentBlock,
    MessageEvent,
    ReasoningEvent,
    SessionFormat,
    SourceFormat,
    UniversalSession,
)

# Schema without the newer thread_source/preview/history_mode columns (Rust test
# `materializes_canonical_codex_layout`).
THREADS_SCHEMA_LEGACY = """CREATE TABLE threads (
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

# Schema with the newer columns (Rust test
# `materialized_codex_sessions_include_turn_events`).
THREADS_SCHEMA_CURRENT = """CREATE TABLE threads (
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
    memory_mode TEXT NOT NULL DEFAULT 'enabled',
    thread_source TEXT,
    preview TEXT NOT NULL DEFAULT '',
    history_mode TEXT NOT NULL DEFAULT 'legacy'
);"""


def test_materializes_canonical_codex_layout(
    fixture: Callable[[str], Path], tmp_path: Path
) -> None:
    """Rust `materializes_canonical_codex_layout`."""
    session = load_session(fixture("claude_current_sample.jsonl"), SourceFormat.CLAUDE)

    sqlite = tmp_path / "state_5.sqlite"
    connection = sqlite3.connect(str(sqlite))
    try:
        connection.executescript(THREADS_SCHEMA_LEGACY)
        connection.commit()

        path = materialize(session, SessionFormat.CODEX, tmp_path)

        assert path.exists()
        assert "/sessions/" in str(path)

        index = tmp_path / "session_index.jsonl"
        assert index.exists()

        registered_count = connection.execute(
            "SELECT COUNT(*) FROM threads"
        ).fetchone()[0]
        assert registered_count == 1

        row_id, title, first_user_message = connection.execute(
            "SELECT id, title, first_user_message FROM threads LIMIT 1"
        ).fetchone()
        assert row_id == session.metadata.session_id
        assert title == row_id
        assert first_user_message == "Inspect README.md"

        text = path.read_text(encoding="utf-8")
        assert '"type":"input_image"' in text
        assert '"name":"Read"' in text
        assert '"cli_version":"0.144.6"' in text
    finally:
        connection.close()


def test_materialized_codex_sessions_include_turn_events(tmp_path: Path) -> None:
    """Rust `materialized_codex_sessions_include_turn_events`."""
    sqlite = tmp_path / "state_5.sqlite"
    connection = sqlite3.connect(str(sqlite))
    try:
        connection.executescript(THREADS_SCHEMA_CURRENT)
        connection.commit()

        session = UniversalSession.new("turn-events")
        session.events.append(
            MessageEvent(
                role="developer",
                blocks=[
                    ContentBlock.make_text(
                        "input_text", "Repository instructions apply."
                    )
                ],
            )
        )
        session.events.append(
            MessageEvent(
                role="user",
                blocks=[ContentBlock.make_text("input_text", "First prompt")],
            )
        )
        session.events.append(
            ReasoningEvent(summary=["Thinking through the task."])
        )
        session.events.append(
            MessageEvent(
                role="assistant",
                blocks=[
                    ContentBlock.make_text(
                        "output_text", "First answer with context."
                    )
                ],
            )
        )
        session.events.append(
            MessageEvent(
                role="user",
                blocks=[ContentBlock.make_text("input_text", "Second prompt")],
            )
        )
        session.events.append(
            MessageEvent(
                role="assistant",
                blocks=[ContentBlock.make_text("output_text", "Second answer.")],
            )
        )

        path = materialize(session, SessionFormat.CODEX, tmp_path)
        lines = [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
        ]

        type_counts = Counter(
            value["type"]
            for value in lines
            if isinstance(value.get("type"), str)
        )
        assert type_counts.get("session_meta") == 1
        assert type_counts.get("turn_context") is None
        assert type_counts.get("event_msg") == 9

        session_meta = next(
            value for value in lines if value.get("type") == "session_meta"
        )
        payload = session_meta["payload"]
        assert payload.get("model_provider") == "OpenAI"
        assert payload.get("cli_version") == "0.144.6"
        assert payload.get("history_mode") == "legacy"
        assert payload.get("base_instructions") is None

        preview, thread_source, history_mode = connection.execute(
            "SELECT preview, thread_source, history_mode FROM threads LIMIT 1"
        ).fetchone()
        assert preview == "First prompt"
        assert thread_source == "user"
        assert history_mode == "legacy"

        event_types = Counter(
            value["payload"]["type"]
            for value in lines
            if value.get("type") == "event_msg"
            and isinstance(value.get("payload"), dict)
            and isinstance(value["payload"].get("type"), str)
        )
        assert event_types.get("task_started") == 2
        assert event_types.get("user_message") == 2
        assert event_types.get("agent_reasoning") == 1
        assert event_types.get("agent_message") == 2
        assert event_types.get("task_complete") == 2
    finally:
        connection.close()


def test_materializes_canonical_claude_layout(
    fixture: Callable[[str], Path], tmp_path: Path
) -> None:
    """Rust `materializes_canonical_claude_layout`."""
    session = load_session(fixture("codex_current_sample.jsonl"), SourceFormat.CODEX)
    path = materialize(session, SessionFormat.CLAUDE, tmp_path)

    assert path.exists()
    assert "/projects/" in str(path)
    history = tmp_path / "history.jsonl"
    assert history.exists()

    saw_image = False
    saw_freeform_tool = False
    saw_structured_tool_result = False
    for line in path.read_text(encoding="utf-8").splitlines():
        value = json.loads(line)
        assert value.get("version") == "2.1.215"
        assert value.get("entrypoint") == "cli"
        message = value.get("message")
        if message is not None:
            assert isinstance(message.get("content"), list)
            if value.get("type") == "assistant":
                assert "model" not in message
            for block in message["content"]:
                block_type = block.get("type")
                assert block_type not in ("input_text", "output_text")
                if block_type == "image":
                    saw_image = True
                elif block_type == "tool_use" and block.get("name") == "exec":
                    assert isinstance(block.get("input"), dict)
                    saw_freeform_tool = True
                elif block_type == "tool_result":
                    content = block["content"]
                    if isinstance(content, list):
                        assert all(
                            item.get("type") in ("text", "image", "document")
                            for item in content
                        )
                        saw_structured_tool_result = True
    assert saw_image
    assert saw_freeform_tool
    assert saw_structured_tool_result


def test_writes_ir_json(fixture: Callable[[str], Path], tmp_path: Path) -> None:
    """Rust `writes_ir_json`."""
    session = load_session(fixture("claude_sample.jsonl"), SourceFormat.CLAUDE)
    output = tmp_path / "session.json"
    path = materialize(session, SessionFormat.IR, output)
    text = path.read_text(encoding="utf-8")
    assert '"ir_version": "handoff/v1"' in text


def test_projects_codex_developer_messages_into_claude(tmp_path: Path) -> None:
    """Rust `projects_codex_developer_messages_into_claude`."""
    session = UniversalSession.new("developer-projection")
    session.events.append(
        MessageEvent(
            role="developer",
            blocks=[
                ContentBlock.make_text(
                    "input_text", "Follow the project instructions carefully."
                )
            ],
        )
    )

    path = materialize(session, SessionFormat.CLAUDE, tmp_path)
    text = path.read_text(encoding="utf-8")
    assert "[handoff imported developer message]" in text


def test_ir_roundtrip_reload_addition(
    fixture: Callable[[str], Path], tmp_path: Path
) -> None:
    """ADDITION (not in the Rust suite): IR materialise -> load_ir round-trips.

    Trivially derived from the `claude_sample` fixture and the `writes_ir_json`
    path: materialising to the IR target and reloading it reproduces the session id
    and event count.
    """
    session = load_session(fixture("claude_sample.jsonl"), SourceFormat.CLAUDE)
    output = tmp_path / "session.json"
    path = materialize(session, SessionFormat.IR, output)

    reloaded = load_ir(path)
    assert reloaded.metadata.session_id == session.metadata.session_id
    assert len(reloaded.events) == len(session.events)
