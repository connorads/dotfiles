"""Codex CLI session format (port of `src/formats/codex.rs`).

Loads a Codex rollout `.jsonl` (`session_meta`, `turn_context`, and the
`response_item` variants: `message`, `reasoning`, `function_call` /
`custom_tool_call`, `function_call_output` / `custom_tool_call_output`) into the IR,
and writes the IR back out as a native Codex session.

Write layout mirrors the Rust `plan_output`:

- a `.jsonl` `output` is written standalone (no index / sqlite sidecars);
- a home-directory `output` grows the full native tree: the rollout under
  `sessions/YYYY/MM/DD/rollout-<local-timestamp>-<session-id>.jsonl`, a
  `session_index.jsonl` line, and a `threads` row in `state_5.sqlite` when present.

Serialisation parity: every JSONL line is a free-form JSON object, so
`write_json_line` (sorted keys, compact, UTF-8) matches the `BTreeMap`-backed
`serde_json::Value` the Rust emits. Timestamps use `SecondsFormat::Millis`
(`format_millis`).
"""

from __future__ import annotations

import contextlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import IO, Any

from .._ids import is_uuid, new_uuid7
from .._json import (
    dumps_compact,
    format_millis,
    now_utc,
    parse_datetime,
    write_json_line,
)
from ..errors import ctx
from ..ir import (
    ContentBlock,
    MessageEvent,
    ReasoningEvent,
    SessionEvent,
    SessionFormat,
    SessionMetadata,
    ToolCallEvent,
    ToolResultEvent,
    UniversalSession,
)

__all__ = ["load", "write"]

CODEX_CLI_VERSION = "0.144.6"
"""`CODEX_CLI_VERSION`."""

CODEX_MODEL_PROVIDER = "OpenAI"
"""`CODEX_MODEL_PROVIDER`."""


@dataclass(frozen=True, slots=True)
class CodexMaterialization:
    """Planned output paths for a Codex write (`CodexMaterialization`)."""

    session_file: Path
    session_index: Path | None


@dataclass(slots=True)
class ActiveTurn:
    """The in-progress turn while streaming events out (`ActiveTurn`)."""

    turn_id: str
    last_agent_message: str | None
    last_timestamp: datetime | None


# --- load --------------------------------------------------------------------------


def load(path: Path) -> UniversalSession:
    """Load a Codex rollout `.jsonl` session into the IR (`codex::load`)."""
    path = Path(path)
    with ctx(lambda: f"failed to open Codex session {path}"):
        raw = path.read_text(encoding="utf-8")

    session = UniversalSession.new(new_uuid7())
    session.metadata.source_format = SessionFormat.CODEX

    # Split on "\n" only, matching Rust `BufReader::lines()`. `str.splitlines()` also
    # breaks on U+2028/U+2029/NEL/VT/FF and lone "\r", which serde_json/json.dumps emit
    # unescaped inside strings, so a valid line containing one would be fragmented.
    for line in raw.split("\n"):
        if not line.strip():
            continue

        with ctx(lambda: f"invalid JSONL in {path}"):
            value = json.loads(line)

        timestamp = _line_timestamp(value)
        _update_time_bounds(session.metadata, timestamp)

        if not isinstance(value, dict):
            continue

        match value.get("type"):
            case "session_meta":
                _import_session_meta(session.metadata, value)
            case "turn_context":
                _import_turn_context(session.metadata, value)
            case "response_item":
                _import_response_item(session.events, value)
            case _:
                pass

    if session.metadata.title is None:
        session.metadata.title = _derive_title(session)

    return session


def _line_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, dict):
        return None
    raw = value.get("timestamp")
    if not isinstance(raw, str):
        return None
    return parse_datetime(raw)


def _import_session_meta(metadata: SessionMetadata, value: dict[str, Any]) -> None:
    payload = value.get("payload")
    if not isinstance(payload, dict):
        return

    session_id = payload.get("id")
    if isinstance(session_id, str):
        metadata.session_id = session_id
    metadata.original_session_id = metadata.session_id
    metadata.source_format = SessionFormat.CODEX

    created = _str_datetime(payload.get("timestamp"))
    if created is not None:
        metadata.created_at = created

    cwd = payload.get("cwd")
    if isinstance(cwd, str):
        metadata.cwd = cwd

    cli_version = payload.get("cli_version")
    if isinstance(cli_version, str):
        metadata.platform_version = cli_version

    if "source" in payload:
        metadata.extra["codex_source"] = payload["source"]
    if "model_provider" in payload:
        metadata.extra["codex_model_provider"] = payload["model_provider"]
    if "originator" in payload:
        metadata.extra["codex_originator"] = payload["originator"]
    base_instructions = payload.get("base_instructions")
    if isinstance(base_instructions, dict) and "text" in base_instructions:
        metadata.extra["codex_base_instructions"] = base_instructions["text"]


def _import_turn_context(metadata: SessionMetadata, value: dict[str, Any]) -> None:
    payload = value.get("payload")
    if not isinstance(payload, dict):
        return

    cwd = payload.get("cwd")
    if isinstance(cwd, str):
        metadata.cwd = cwd

    model = payload.get("model")
    if isinstance(model, str):
        metadata.model = model

    if "personality" in payload:
        metadata.extra["codex_personality"] = payload["personality"]
    _copy_if_present(payload, metadata, "approval_policy", "codex_approval_policy")
    _copy_if_present(payload, metadata, "sandbox_policy", "codex_sandbox_policy")
    _copy_if_present(payload, metadata, "collaboration_mode", "codex_collaboration_mode")
    _copy_if_present(payload, metadata, "user_instructions", "codex_user_instructions")
    _copy_if_present(payload, metadata, "timezone", "codex_timezone")
    _copy_if_present(payload, metadata, "current_date", "codex_current_date")


def _import_response_item(events: list[SessionEvent], value: dict[str, Any]) -> None:
    payload = value.get("payload")
    if not isinstance(payload, dict):
        return
    payload_type = payload.get("type")
    if not isinstance(payload_type, str):
        return
    timestamp = _line_timestamp(value)

    match payload_type:
        case "message":
            _import_message(events, payload, timestamp)
        case "reasoning":
            _import_reasoning(events, payload, timestamp)
        case "function_call" | "custom_tool_call":
            _import_tool_call(events, payload, timestamp)
        case "function_call_output" | "custom_tool_call_output":
            _import_tool_result(events, payload, timestamp)
        case _:
            pass


def _import_message(
    events: list[SessionEvent], payload: dict[str, Any], timestamp: datetime | None
) -> None:
    role = payload.get("role")
    if not isinstance(role, str):
        role = "assistant"

    content = payload.get("content")
    blocks = [_normalize_block(item) for item in content] if isinstance(content, list) else []
    if not blocks:
        return

    message_id = payload.get("id")
    events.append(
        MessageEvent(
            role=role,
            id=message_id if isinstance(message_id, str) else None,
            parent_id=None,
            timestamp=timestamp,
            blocks=blocks,
            metadata={},
        )
    )


def _import_reasoning(
    events: list[SessionEvent], payload: dict[str, Any], timestamp: datetime | None
) -> None:
    summary_raw = payload.get("summary")
    summary: list[str] = []
    if isinstance(summary_raw, list):
        for item in summary_raw:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    summary.append(text)
    if not summary:
        return

    reasoning_id = payload.get("id")
    events.append(
        ReasoningEvent(
            id=reasoning_id if isinstance(reasoning_id, str) else None,
            parent_id=None,
            timestamp=timestamp,
            summary=summary,
            metadata={},
        )
    )


def _import_tool_call(
    events: list[SessionEvent], payload: dict[str, Any], timestamp: datetime | None
) -> None:
    if "arguments" in payload:
        raw = payload["arguments"]
    elif "input" in payload:
        raw = payload["input"]
    else:
        raw = None
    arguments = _parse_jsonish(raw) if isinstance(raw, str) else raw

    call_id = payload.get("call_id")
    name = payload.get("name")
    tool_id = payload.get("id")
    events.append(
        ToolCallEvent(
            call_id=call_id if isinstance(call_id, str) else "",
            name=name if isinstance(name, str) else "unknown",
            id=tool_id if isinstance(tool_id, str) else None,
            parent_id=None,
            timestamp=timestamp,
            arguments=arguments,
            metadata={},
        )
    )


def _import_tool_result(
    events: list[SessionEvent], payload: dict[str, Any], timestamp: datetime | None
) -> None:
    output = payload.get("output", "")

    call_id = payload.get("call_id")
    tool_id = payload.get("id")
    events.append(
        ToolResultEvent(
            call_id=call_id if isinstance(call_id, str) else "",
            output=output,
            is_error=False,
            id=tool_id if isinstance(tool_id, str) else None,
            parent_id=None,
            timestamp=timestamp,
            metadata={},
        )
    )


def _normalize_block(value: Any) -> ContentBlock:
    if not isinstance(value, dict):
        return ContentBlock(kind="text", text=None, data=None)

    kind = value.get("type")
    if not isinstance(kind, str):
        kind = "text"

    text: str | None = None
    for key in ("text", "thinking", "content"):
        candidate = value.get(key)
        if isinstance(candidate, str):
            text = candidate
            break

    remainder = {
        key: val for key, val in value.items() if key not in ("type", "text", "thinking", "content")
    }
    data = remainder if remainder else None

    return ContentBlock(kind=kind, text=text, data=data)


# --- write -------------------------------------------------------------------------


def write(session: UniversalSession, output: Path) -> Path:
    """Materialise the IR as a Codex session, returning the rollout file (`codex::write`).

    `output` is either a `.jsonl` file (written standalone) or a Codex home directory
    (rollout written under `sessions/YYYY/MM/DD/`, session index appended, thread
    registered in `state_5.sqlite` when present).
    """
    output = Path(output)
    materialization = _plan_output(session, output)
    parent = materialization.session_file.parent
    with ctx(lambda: f"failed to create {parent}"):
        parent.mkdir(parents=True, exist_ok=True)

    with ctx(lambda: f"failed to create Codex session file {materialization.session_file}"):
        handle = open(  # noqa: SIM115 - closed explicitly below
            materialization.session_file, "w", encoding="utf-8", newline="\n"
        )

    with handle:
        session_id = _codex_session_id(session.metadata.session_id)
        created_at = _resolve_created_at(session)
        updated_at = _resolve_updated_at(session, created_at)
        cwd = session.metadata.cwd if session.metadata.cwd is not None else "."

        _write_session_meta(handle, session, session_id, created_at, cwd)

        active_turn: ActiveTurn | None = None
        for event in session.events:
            active_turn = _write_event(handle, event, active_turn, updated_at)

        _close_turn(handle, active_turn, updated_at)
        active_turn = None

    thread_name = _exported_codex_thread_name(session, session_id)

    if materialization.session_index is not None:
        index = materialization.session_index
        index_parent = index.parent
        with ctx(lambda: f"failed to create {index_parent}"):
            index_parent.mkdir(parents=True, exist_ok=True)
        with ctx(lambda: f"failed to open {index}"):
            index_handle = open(  # noqa: SIM115 - closed by the with-block
                index, "a", encoding="utf-8", newline="\n"
            )
        with index_handle:
            write_json_line(
                index_handle,
                {
                    "id": session_id,
                    "thread_name": thread_name,
                    "updated_at": format_millis(updated_at),
                },
            )

    if output.suffix != ".jsonl":
        _register_thread_in_sqlite(
            output,
            session,
            materialization.session_file,
            session_id,
            thread_name,
            created_at,
            updated_at,
        )

    return materialization.session_file


def _plan_output(session: UniversalSession, output: Path) -> CodexMaterialization:
    if output.suffix == ".jsonl":
        return CodexMaterialization(session_file=output, session_index=None)

    created_at = session.metadata.created_at
    if created_at is None:
        created_at = now_utc()
    local = created_at.astimezone()
    session_id = _codex_session_id(session.metadata.session_id)
    relative = (
        Path("sessions")
        / f"{local.year:04d}"
        / f"{local.month:02d}"
        / f"{local.day:02d}"
        / f"rollout-{local.strftime('%Y-%m-%dT%H-%M-%S')}-{session_id}.jsonl"
    )
    return CodexMaterialization(
        session_file=output / relative,
        session_index=output / "session_index.jsonl",
    )


def _resolve_created_at(session: UniversalSession) -> datetime:
    if session.metadata.created_at is not None:
        return session.metadata.created_at
    stamps = [e.timestamp for e in session.events if e.timestamp is not None]
    return min(stamps) if stamps else now_utc()


def _resolve_updated_at(session: UniversalSession, created_at: datetime) -> datetime:
    if session.metadata.updated_at is not None:
        return session.metadata.updated_at
    stamps = [e.timestamp for e in session.events if e.timestamp is not None]
    return max(stamps) if stamps else created_at


def _write_session_meta(
    handle: IO[str],
    session: UniversalSession,
    session_id: str,
    created_at: datetime,
    cwd: str,
) -> None:
    # Presence check, not truthiness: Rust `unwrap_or_else` replaces only `None`, so an
    # empty-string originator/approval policy is preserved rather than defaulted.
    originator = _extra_string(session.metadata, "codex_originator")
    if originator is None:
        originator = "handoff"
    payload: dict[str, Any] = {
        "id": session_id,
        "session_id": session_id,
        "timestamp": format_millis(created_at),
        "cwd": cwd,
        "originator": originator,
        "cli_version": CODEX_CLI_VERSION,
        "source": session.metadata.extra.get("codex_source", "cli"),
        "model_provider": CODEX_MODEL_PROVIDER,
        "thread_source": "user",
        "history_mode": "legacy",
    }
    base_instructions = _extra_string(session.metadata, "codex_base_instructions")
    if base_instructions is not None:
        payload["base_instructions"] = {"text": base_instructions}

    write_json_line(
        handle,
        {
            "timestamp": format_millis(created_at),
            "type": "session_meta",
            "payload": payload,
        },
    )


def _write_event(
    handle: IO[str],
    event: SessionEvent,
    active_turn: ActiveTurn | None,
    updated_at: datetime,
) -> ActiveTurn | None:
    match event:
        case MessageEvent():
            return _write_message_event(handle, event, active_turn, updated_at)
        case ReasoningEvent():
            return _write_reasoning_event(handle, event, active_turn, updated_at)
        case ToolCallEvent():
            return _write_tool_call_event(handle, event, active_turn, updated_at)
        case ToolResultEvent():
            return _write_tool_result_event(handle, event, active_turn, updated_at)
    return active_turn


def _write_message_event(
    handle: IO[str],
    message: MessageEvent,
    active_turn: ActiveTurn | None,
    updated_at: datetime,
) -> ActiveTurn | None:
    timestamp = message.timestamp if message.timestamp is not None else updated_at
    rendered_text = _render_message_text(message)

    if message.role == "user":
        _close_turn(handle, active_turn, updated_at)
        active_turn = _start_turn(handle, timestamp)
        _write_message_response_item(handle, message, updated_at)
        images = [
            url for url in (_codex_image_url(block) for block in message.blocks) if url is not None
        ]
        if rendered_text is not None or images:
            write_json_line(
                handle,
                {
                    "timestamp": _render_ts(message.timestamp, updated_at),
                    "type": "event_msg",
                    "payload": {
                        "type": "user_message",
                        "message": rendered_text if rendered_text is not None else "",
                        "images": images,
                        "local_images": [],
                        "text_elements": [],
                    },
                },
            )
        if active_turn is not None:
            active_turn.last_timestamp = timestamp
        return active_turn

    if message.role != "developer" and active_turn is None:
        active_turn = _start_turn(handle, timestamp)

    if message.role == "assistant" and rendered_text is not None:
        write_json_line(
            handle,
            {
                "timestamp": _render_ts(message.timestamp, updated_at),
                "type": "event_msg",
                "payload": {
                    "type": "agent_message",
                    "message": rendered_text,
                    "phase": "commentary",
                },
            },
        )
        if active_turn is not None:
            active_turn.last_agent_message = rendered_text

    _write_message_response_item(handle, message, updated_at)
    if active_turn is not None:
        active_turn.last_timestamp = timestamp
    return active_turn


def _write_reasoning_event(
    handle: IO[str],
    reasoning: ReasoningEvent,
    active_turn: ActiveTurn | None,
    updated_at: datetime,
) -> ActiveTurn | None:
    timestamp = reasoning.timestamp if reasoning.timestamp is not None else updated_at
    if active_turn is None:
        active_turn = _start_turn(handle, timestamp)

    summary_text = _render_reasoning_text(reasoning)
    if summary_text:
        write_json_line(
            handle,
            {
                "timestamp": _render_ts(reasoning.timestamp, updated_at),
                "type": "event_msg",
                "payload": {"type": "agent_reasoning", "text": summary_text},
            },
        )

    write_json_line(
        handle,
        {
            "timestamp": _render_ts(reasoning.timestamp, updated_at),
            "type": "response_item",
            "payload": {
                "type": "reasoning",
                "summary": [{"type": "summary_text", "text": text} for text in reasoning.summary],
            },
        },
    )
    if active_turn is not None:
        active_turn.last_timestamp = timestamp
    return active_turn


def _write_tool_call_event(
    handle: IO[str],
    call: ToolCallEvent,
    active_turn: ActiveTurn | None,
    updated_at: datetime,
) -> ActiveTurn | None:
    timestamp = call.timestamp if call.timestamp is not None else updated_at
    if active_turn is None:
        active_turn = _start_turn(handle, timestamp)

    write_json_line(
        handle,
        {
            "timestamp": _render_ts(call.timestamp, updated_at),
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "id": call.id if call.id is not None else new_uuid7(),
                "name": call.name,
                "call_id": call.call_id,
                "arguments": _json_to_string(call.arguments),
            },
        },
    )
    if active_turn is not None:
        active_turn.last_timestamp = timestamp
    return active_turn


def _write_tool_result_event(
    handle: IO[str],
    result: ToolResultEvent,
    active_turn: ActiveTurn | None,
    updated_at: datetime,
) -> ActiveTurn | None:
    timestamp = result.timestamp if result.timestamp is not None else updated_at
    if active_turn is None:
        active_turn = _start_turn(handle, timestamp)

    write_json_line(
        handle,
        {
            "timestamp": _render_ts(result.timestamp, updated_at),
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "call_id": result.call_id,
                "output": _json_to_string(result.output),
            },
        },
    )
    if active_turn is not None:
        active_turn.last_timestamp = timestamp
    return active_turn


def _start_turn(handle: IO[str], timestamp: datetime) -> ActiveTurn:
    turn_id = new_uuid7()
    write_json_line(
        handle,
        {
            "timestamp": format_millis(timestamp),
            "type": "event_msg",
            "payload": {
                "type": "task_started",
                "turn_id": turn_id,
                "model_context_window": 950000,
                "collaboration_mode_kind": "default",
            },
        },
    )
    return ActiveTurn(turn_id=turn_id, last_agent_message=None, last_timestamp=timestamp)


def _close_turn(handle: IO[str], active_turn: ActiveTurn | None, fallback: datetime) -> None:
    if active_turn is None:
        return
    write_json_line(
        handle,
        {
            "timestamp": _render_ts(active_turn.last_timestamp, fallback),
            "type": "event_msg",
            "payload": {
                "type": "task_complete",
                "turn_id": active_turn.turn_id,
                "last_agent_message": active_turn.last_agent_message
                if active_turn.last_agent_message is not None
                else "",
            },
        },
    )


def _write_message_response_item(
    handle: IO[str], message: MessageEvent, fallback: datetime
) -> None:
    blocks: list[dict[str, Any]] = []
    for block in message.blocks:
        if block.text is not None:
            entry: dict[str, Any] = {
                "type": _codex_block_kind(message.role, block.kind),
                "text": block.text,
            }
            if isinstance(block.data, dict):
                entry.update(block.data)
            blocks.append(entry)
        else:
            image_url = _codex_image_url(block)
            if image_url is None:
                continue
            blocks.append({"type": "input_image", "image_url": image_url})

    if not blocks:
        return

    write_json_line(
        handle,
        {
            "timestamp": _render_ts(message.timestamp, fallback),
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": message.role,
                "content": blocks,
            },
        },
    )


# --- helpers -----------------------------------------------------------------------


def _str_datetime(raw: Any) -> datetime | None:
    if not isinstance(raw, str):
        return None
    return parse_datetime(raw)


def _parse_jsonish(value: str) -> Any:
    try:
        return json.loads(value)
    except (json.JSONDecodeError, ValueError):
        return value


def _json_to_string(value: Any) -> str:
    if isinstance(value, str):
        return value
    return dumps_compact(value)


def _render_ts(timestamp: datetime | None, fallback: datetime) -> str:
    return format_millis(timestamp if timestamp is not None else fallback)


def _update_time_bounds(metadata: SessionMetadata, timestamp: datetime | None) -> None:
    if timestamp is None:
        return
    if metadata.created_at is None:
        metadata.created_at = timestamp
    else:
        metadata.created_at = min(metadata.created_at, timestamp)
    if metadata.updated_at is None:
        metadata.updated_at = timestamp
    else:
        metadata.updated_at = max(metadata.updated_at, timestamp)


def _derive_title(session: UniversalSession) -> str | None:
    if session.metadata.title is not None:
        return session.metadata.title

    for event in session.events:
        if not isinstance(event, MessageEvent):
            continue
        if event.role != "user":
            continue
        for block in event.blocks:
            if block.text is None:
                continue
            collapsed = _collapse_whitespace(block.text)
            if collapsed:
                return collapsed
    return None


def _collapse_whitespace(text: str) -> str:
    collapsed = " ".join(text.split())
    return collapsed[:80]


def _copy_if_present(
    payload: dict[str, Any],
    metadata: SessionMetadata,
    input_key: str,
    output_key: str,
) -> None:
    if input_key in payload:
        metadata.extra[output_key] = payload[input_key]


def _extra_string(metadata: SessionMetadata, key: str) -> str | None:
    value = metadata.extra.get(key)
    return value if isinstance(value, str) else None


def _codex_session_id(candidate: str) -> str:
    return candidate if is_uuid(candidate) else new_uuid7()


def _exported_codex_thread_name(session: UniversalSession, session_id: str) -> str:
    if session.metadata.source_format == SessionFormat.CODEX:
        title = _derive_title(session)
        return title if title is not None else session_id
    return session_id


def _codex_image_url(block: ContentBlock) -> str | None:
    if not isinstance(block.data, dict):
        return None
    data = block.data

    if block.kind == "input_image":
        image_url = data.get("image_url")
        return image_url if isinstance(image_url, str) else None

    if block.kind != "image":
        return None

    source = data.get("source")
    if not isinstance(source, dict):
        return None

    match source.get("type"):
        case "base64":
            media_type = source.get("media_type")
            encoded = source.get("data")
            if isinstance(media_type, str) and isinstance(encoded, str):
                return f"data:{media_type};base64,{encoded}"
            return None
        case "url":
            url = source.get("url")
            return url if isinstance(url, str) else None
        case _:
            return None


def _render_message_text(message: MessageEvent) -> str | None:
    parts = [
        stripped
        for block in message.blocks
        if block.text is not None
        for stripped in (block.text.strip(),)
        if stripped
    ]
    text = "\n\n".join(parts)
    return text if text else None


def _render_reasoning_text(reasoning: ReasoningEvent) -> str:
    parts = [stripped for item in reasoning.summary for stripped in (item.strip(),) if stripped]
    return "\n\n".join(parts)


def _codex_block_kind(role: str, original_kind: str) -> str:
    match original_kind:
        case "input_text":
            return "input_text"
        case "output_text":
            return "output_text"
        case _:
            return "output_text" if role == "assistant" else "input_text"


def _register_thread_in_sqlite(
    codex_root: Path,
    session: UniversalSession,
    session_file: Path,
    session_id: str,
    thread_name: str,
    created_at: datetime,
    updated_at: datetime,
) -> None:
    sqlite_path = codex_root / "state_5.sqlite"
    if not sqlite_path.exists():
        return

    with ctx(lambda: f"failed to open {sqlite_path}"):
        connection = sqlite3.connect(sqlite_path, isolation_level=None)

    with connection:
        title = thread_name
        first_message = _first_user_message(session)
        first_user = first_message if first_message is not None else title
        cwd = session.metadata.cwd if session.metadata.cwd is not None else "."
        if "codex_sandbox_policy" in session.metadata.extra:
            sandbox_policy = _json_to_string(session.metadata.extra["codex_sandbox_policy"])
        else:
            sandbox_policy = '{"type":"workspace-write"}'
        approval_mode = _extra_string(session.metadata, "codex_approval_policy")
        if approval_mode is None:
            approval_mode = "on-request"
        git_branch = session.metadata.git_branch
        has_user_event = int(
            any(
                isinstance(event, MessageEvent) and event.role == "user" for event in session.events
            )
        )

        with ctx(lambda: f"failed to register thread {session_id} in {sqlite_path}"):
            connection.execute(
                """INSERT INTO threads (
                    id,
                    rollout_path,
                    created_at,
                    updated_at,
                    source,
                    model_provider,
                    cwd,
                    title,
                    sandbox_policy,
                    approval_mode,
                    tokens_used,
                    has_user_event,
                    archived,
                    git_sha,
                    git_branch,
                    git_origin_url,
                    cli_version,
                    first_user_message,
                    agent_nickname,
                    agent_role,
                    memory_mode
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, 0, NULL, ?12, NULL, ?13, ?14, NULL, NULL, 'enabled'
                )
                ON CONFLICT(id) DO UPDATE SET
                    rollout_path=excluded.rollout_path,
                    updated_at=excluded.updated_at,
                    source=excluded.source,
                    model_provider=excluded.model_provider,
                    cwd=excluded.cwd,
                    title=excluded.title,
                    sandbox_policy=excluded.sandbox_policy,
                    approval_mode=excluded.approval_mode,
                    has_user_event=excluded.has_user_event,
                    git_branch=excluded.git_branch,
                    cli_version=excluded.cli_version,
                    first_user_message=excluded.first_user_message,
                    memory_mode=excluded.memory_mode""",
                (
                    session_id,
                    str(session_file),
                    int(created_at.timestamp()),
                    int(updated_at.timestamp()),
                    "cli",
                    CODEX_MODEL_PROVIDER,
                    cwd,
                    title,
                    sandbox_policy,
                    approval_mode,
                    has_user_event,
                    git_branch,
                    CODEX_CLI_VERSION,
                    first_user,
                ),
            )

        # Codex 0.144+ hides rows without a preview; older state DBs lack these columns.
        with contextlib.suppress(sqlite3.Error):
            connection.execute(
                "UPDATE threads SET preview = ?1, thread_source = 'user', "
                "history_mode = 'legacy' WHERE id = ?2",
                (first_user, session_id),
            )

    connection.close()


def _first_user_message(session: UniversalSession) -> str | None:
    for event in session.events:
        if not isinstance(event, MessageEvent):
            continue
        if event.role != "user":
            continue
        for block in event.blocks:
            if block.text is None:
                continue
            collapsed = _collapse_whitespace(block.text)
            if collapsed:
                return collapsed
    return None
