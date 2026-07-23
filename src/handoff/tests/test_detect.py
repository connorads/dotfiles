"""Format detection and native-import tests.

Ported from `tests/roundtrip.rs`:

- `detects_and_imports_codex_fixture`
- `detects_and_imports_current_codex_fixture`
- `detects_and_imports_claude_fixture`
- `detects_and_imports_current_claude_fixture`
- `auto_detects_pretty_printed_ir`
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from handoff.formats import detect_format, load_session
from handoff.ir import (
    MessageEvent,
    ReasoningEvent,
    SessionFormat,
    SourceFormat,
    ToolCallEvent,
    ToolResultEvent,
)


def test_detects_and_imports_codex_fixture(fixture: Callable[[str], Path]) -> None:
    """Rust `detects_and_imports_codex_fixture`."""
    path = fixture("codex_sample.jsonl")
    assert detect_format(path) == SessionFormat.CODEX

    session = load_session(path, SourceFormat.AUTO)
    assert session.metadata.session_id == "019cd6bd-10df-7e61-8506-e9ac5bdf4e6e"
    assert any(isinstance(event, ToolCallEvent) for event in session.events)
    assert any(isinstance(event, ToolResultEvent) for event in session.events)


def test_detects_and_imports_current_codex_fixture(
    fixture: Callable[[str], Path],
) -> None:
    """Rust `detects_and_imports_current_codex_fixture`."""
    path = fixture("codex_current_sample.jsonl")
    assert detect_format(path) == SessionFormat.CODEX

    session = load_session(path, SourceFormat.AUTO)
    assert session.metadata.session_id == "019d5294-7fd5-7e21-bcca-32362218c185"
    assert session.metadata.model == "gpt-5.6"
    assert session.metadata.extra.get("codex_model_provider") == "OpenAI"
    assert session.metadata.platform_version == "0.144.6"
    assert any(isinstance(event, ReasoningEvent) for event in session.events)
    assert any(isinstance(event, ToolCallEvent) for event in session.events)
    assert any(isinstance(event, ToolResultEvent) for event in session.events)
    assert any(
        isinstance(event, ToolCallEvent)
        and event.name == "exec"
        and isinstance(event.arguments, str)
        for event in session.events
    )


def test_detects_and_imports_claude_fixture(fixture: Callable[[str], Path]) -> None:
    """Rust `detects_and_imports_claude_fixture`."""
    path = fixture("claude_sample.jsonl")
    assert detect_format(path) == SessionFormat.CLAUDE

    session = load_session(path, SourceFormat.AUTO)
    assert session.metadata.session_id == "d89e26cd-11f2-47e8-bea5-a73ad5458483"
    assert any(isinstance(event, ReasoningEvent) for event in session.events)
    assert any(isinstance(event, ToolCallEvent) for event in session.events)
    assert isinstance(session.events[1], ReasoningEvent)
    assert isinstance(session.events[2], MessageEvent)


def test_detects_and_imports_current_claude_fixture(
    fixture: Callable[[str], Path],
) -> None:
    """Rust `detects_and_imports_current_claude_fixture`."""
    path = fixture("claude_current_sample.jsonl")
    assert detect_format(path) == SessionFormat.CLAUDE

    session = load_session(path, SourceFormat.AUTO)
    assert session.metadata.session_id == "63679569-7045-45ba-bfef-cad8b1045769"
    assert session.metadata.platform_version == "2.1.215"
    assert session.metadata.model == "claude-opus-4.8"
    assert any(isinstance(event, ReasoningEvent) for event in session.events)
    message_count = sum(1 for event in session.events if isinstance(event, MessageEvent))
    assert message_count == 3
    assert any(isinstance(event, ToolCallEvent) for event in session.events)
    assert any(isinstance(event, ToolResultEvent) for event in session.events)
    assert not any(
        isinstance(event, MessageEvent)
        and any(
            block.text is not None and "Internal command output" in block.text
            for block in event.blocks
        )
        for event in session.events
    )


def test_auto_detects_pretty_printed_ir(tmp_path: Path) -> None:
    """Rust `auto_detects_pretty_printed_ir`."""
    input_path = tmp_path / "session.json"
    input_path.write_text(
        """{
  "ir_version": "handoff/v1",
  "metadata": {
    "session_id": "test-session"
  },
  "events": []
}""",
        encoding="utf-8",
    )

    assert detect_format(input_path) == SessionFormat.IR
