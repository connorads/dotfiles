"""Claude Code session format (port of `src/formats/claude.rs`).

Loads a Claude Code `.jsonl` session into the `UniversalSession` IR and writes the IR
back out as a native Claude session file. `write` chooses the
`projects/<munged-cwd>/<session-id>.jsonl` location when handed a Claude home root, or
writes standalone when handed a `.jsonl` path.

Parity notes:

- Every JSONL line the writer emits is free-form JSON, so keys are sorted recursively by
  `write_json_line`/`dumps_compact` (the `serde_json` `BTreeMap` behaviour). Line dicts
  are therefore built in readable order and re-sorted on emit.
- Timestamps in emitted lines use millisecond precision + `Z` (`SecondsFormat::Millis`).
- `parentUuid` / `sourceToolAssistantUUID` are always present, serialising to `null`
  when absent, matching serde's `Option` encoding for a `json!` field.
"""

from __future__ import annotations

import dataclasses
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from .._ids import new_uuid4, new_uuid4_simple, normalize_uuid
from .._json import (
    dumps_compact,
    format_millis,
    now_utc,
    parse_datetime,
    timestamp_millis,
    write_json_line,
)
from ..errors import ctx
from ..ir import (
    ContentBlock,
    JsonValue,
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

CLAUDE_CODE_VERSION = "2.1.215"
"""`CLAUDE_CODE_VERSION` written into materialised session lines."""


# --- small JSON accessors (the `Value::as_*` / `.get` helpers) ----------------------


def _get(value: Any, key: str) -> Any:
    """`value.get(key)` for a JSON object, else None (`Value::get` on a non-object)."""
    return value.get(key) if isinstance(value, dict) else None


def _as_str(value: Any) -> str | None:
    """`Value::as_str`."""
    return value if isinstance(value, str) else None


def _as_bool(value: Any) -> bool | None:
    """`Value::as_bool`."""
    return value if isinstance(value, bool) else None


def _as_array(value: Any) -> list[Any] | None:
    """`Value::as_array`."""
    return value if isinstance(value, list) else None


# --- load ---------------------------------------------------------------------------


def load(path: Path) -> UniversalSession:
    """Load a Claude `.jsonl` session into the IR (`claude::load`)."""
    with ctx(lambda: f"failed to open Claude session {path}"):
        handle = open(path, encoding="utf-8", newline="")
    try:
        with ctx(lambda: f"failed to read {path}"):
            lines = handle.readlines()
    finally:
        handle.close()

    session = UniversalSession.new(new_uuid4())
    session.metadata.source_format = SessionFormat.CLAUDE

    for line in lines:
        if not line.strip():
            continue

        with ctx(lambda: f"invalid JSONL in {path}"):
            value = json.loads(line)

        _import_metadata(session.metadata, value)
        if _as_bool(_get(value, "isMeta")) is True or _as_bool(
            _get(value, "isSidechain")
        ) is True:
            continue

        match _as_str(_get(value, "type")):
            case "user":
                _import_user_entry(session.events, value)
            case "assistant":
                _import_assistant_entry(session.events, value)
            case _:
                pass

    if session.metadata.title is None:
        session.metadata.title = _derive_title(session)

    return session


def _import_metadata(metadata: SessionMetadata, value: Any) -> None:
    session_id = _as_str(_get(value, "sessionId"))
    if session_id is not None:
        metadata.session_id = session_id
        metadata.original_session_id = session_id
        metadata.source_format = SessionFormat.CLAUDE
    cwd = _as_str(_get(value, "cwd"))
    if cwd is not None:
        metadata.cwd = cwd
    branch = _as_str(_get(value, "gitBranch"))
    if branch is not None:
        metadata.git_branch = branch
    version = _as_str(_get(value, "version"))
    if version is not None:
        metadata.platform_version = version
    model = _as_str(_get(_get(value, "message"), "model"))
    if model is not None:
        metadata.model = model
    timestamp = _parse_timestamp(value)
    _update_time_bounds(metadata, timestamp)


def _parse_timestamp(value: Any) -> datetime | None:
    raw = _as_str(_get(value, "timestamp"))
    return parse_datetime(raw) if raw is not None else None


def _import_user_entry(events: list[SessionEvent], value: Any) -> None:
    timestamp = _parse_timestamp(value)
    uuid = _as_str(_get(value, "uuid"))
    parent_uuid = _as_str(_get(value, "parentUuid"))

    message = _get(value, "message")
    if message is None:
        return

    content = _get(message, "content")
    if isinstance(content, str):
        if not content.strip():
            return
        events.append(
            MessageEvent(
                role="user",
                id=uuid,
                parent_id=parent_uuid,
                timestamp=timestamp,
                blocks=[ContentBlock.make_text("text", content)],
                metadata={},
            )
        )
    elif isinstance(content, list):
        message_blocks: list[ContentBlock] = []
        for item in content:
            if _as_str(_get(item, "type")) == "tool_result":
                if message_blocks:
                    events.append(
                        MessageEvent(
                            role="user",
                            id=uuid,
                            parent_id=parent_uuid,
                            timestamp=timestamp,
                            blocks=message_blocks,
                            metadata={},
                        )
                    )
                    message_blocks = []
                _import_tool_result_block(events, item, timestamp, uuid, parent_uuid)
            else:
                message_blocks.append(_normalize_block(item))

        if message_blocks:
            events.append(
                MessageEvent(
                    role="user",
                    id=uuid,
                    parent_id=parent_uuid,
                    timestamp=timestamp,
                    blocks=message_blocks,
                    metadata={},
                )
            )


def _import_assistant_entry(events: list[SessionEvent], value: Any) -> None:
    timestamp = _parse_timestamp(value)
    uuid = _as_str(_get(value, "uuid"))
    parent_uuid = _as_str(_get(value, "parentUuid"))
    message = _get(value, "message")
    if message is None:
        return

    shared_metadata: dict[str, Any] = {}
    if isinstance(message, dict):
        if "model" in message:
            shared_metadata["model"] = message["model"]
        if "stop_reason" in message:
            shared_metadata["stop_reason"] = message["stop_reason"]

    content = _as_array(_get(message, "content"))
    if content is None:
        return

    message_blocks: list[ContentBlock] = []
    reasoning_blocks: list[str] = []

    for index, item in enumerate(content):
        match _as_str(_get(item, "type")):
            case "tool_use":
                reasoning_blocks = _flush_reasoning(
                    events,
                    reasoning_blocks,
                    _suffix(uuid, f":reasoning:{index}"),
                    parent_uuid,
                    timestamp,
                    shared_metadata,
                )
                message_blocks = _flush_message(
                    events,
                    message_blocks,
                    _suffix(uuid, f":msg:{index}"),
                    parent_uuid,
                    timestamp,
                    shared_metadata,
                )
                _import_tool_use_block(events, item, timestamp, uuid, parent_uuid)
            case "thinking":
                message_blocks = _flush_message(
                    events,
                    message_blocks,
                    _suffix(uuid, f":msg:{index}"),
                    parent_uuid,
                    timestamp,
                    shared_metadata,
                )
                text = _as_str(_get(item, "thinking"))
                if text is not None:
                    reasoning_blocks.append(text)
            case _:
                reasoning_blocks = _flush_reasoning(
                    events,
                    reasoning_blocks,
                    _suffix(uuid, f":reasoning:{index}"),
                    parent_uuid,
                    timestamp,
                    shared_metadata,
                )
                message_blocks.append(_normalize_block(item))

    _flush_reasoning(
        events,
        reasoning_blocks,
        _suffix(uuid, ":reasoning"),
        parent_uuid,
        timestamp,
        shared_metadata,
    )
    _flush_message(
        events,
        message_blocks,
        uuid,
        parent_uuid,
        timestamp,
        shared_metadata,
    )


def _suffix(uuid: str | None, suffix: str) -> str | None:
    """`uuid.map(|base| format!("{base}{suffix}"))`."""
    return None if uuid is None else f"{uuid}{suffix}"


def _flush_message(
    events: list[SessionEvent],
    blocks: list[ContentBlock],
    id: str | None,
    parent_id: str | None,
    timestamp: datetime | None,
    metadata: dict[str, Any],
) -> list[ContentBlock]:
    """Emit an assistant message for the buffered blocks; return a fresh buffer."""
    if not blocks:
        return blocks
    events.append(
        MessageEvent(
            role="assistant",
            id=id,
            parent_id=parent_id,
            timestamp=timestamp,
            blocks=blocks,
            metadata=dict(metadata),
        )
    )
    return []


def _flush_reasoning(
    events: list[SessionEvent],
    summary: list[str],
    id: str | None,
    parent_id: str | None,
    timestamp: datetime | None,
    metadata: dict[str, Any],
) -> list[str]:
    """Emit a reasoning event for the buffered summary; return a fresh buffer."""
    if not summary:
        return summary
    events.append(
        ReasoningEvent(
            id=id,
            parent_id=parent_id,
            timestamp=timestamp,
            summary=summary,
            metadata=dict(metadata),
        )
    )
    return []


def _import_tool_use_block(
    events: list[SessionEvent],
    item: Any,
    timestamp: datetime | None,
    parent_id: str | None,
    source_parent: str | None,
) -> None:
    call_id = _as_str(_get(item, "id"))
    call_id = call_id if call_id is not None else ""
    name = _as_str(_get(item, "name"))
    name = name if name is not None else "unknown"
    arguments = _get(item, "input")

    metadata: dict[str, Any] = {}
    if isinstance(item, dict) and "caller" in item:
        # Presence check, not not-None: Rust `item.get("caller")` returns `Some(Null)`
        # for an explicit JSON null, so `caller: null` round-trips as metadata.caller.
        metadata["caller"] = item["caller"]

    events.append(
        ToolCallEvent(
            call_id=call_id,
            name=name,
            id=parent_id,
            parent_id=source_parent,
            timestamp=timestamp,
            arguments=arguments,
            metadata=metadata,
        )
    )


def _import_tool_result_block(
    events: list[SessionEvent],
    item: Any,
    timestamp: datetime | None,
    event_id: str | None,
    parent_id: str | None,
) -> None:
    output = _get(item, "content")
    is_error = _as_bool(_get(item, "is_error"))
    is_error = is_error if is_error is not None else False
    call_id = _as_str(_get(item, "tool_use_id"))
    call_id = call_id if call_id is not None else ""

    events.append(
        ToolResultEvent(
            call_id=call_id,
            output=output,
            is_error=is_error,
            id=event_id,
            parent_id=parent_id,
            timestamp=timestamp,
            metadata={},
        )
    )


def _normalize_block(value: Any) -> ContentBlock:
    kind = _as_str(_get(value, "type"))
    kind = kind if kind is not None else "text"
    text: str | None = None
    for key in ("text", "thinking", "content"):
        candidate = _as_str(_get(value, key))
        if candidate is not None:
            text = candidate
            break
    obj = dict(value) if isinstance(value, dict) else {}
    for key in ("type", "text", "thinking", "content"):
        obj.pop(key, None)
    data: JsonValue | None = obj if obj else None
    return ContentBlock(kind=kind, text=text, data=data)


def _update_time_bounds(
    metadata: SessionMetadata, timestamp: datetime | None
) -> None:
    if timestamp is None:
        return
    metadata.created_at = (
        timestamp
        if metadata.created_at is None
        else min(metadata.created_at, timestamp)
    )
    metadata.updated_at = (
        timestamp
        if metadata.updated_at is None
        else max(metadata.updated_at, timestamp)
    )


def _derive_title(session: UniversalSession) -> str | None:
    for event in session.events:
        if not isinstance(event, MessageEvent) or event.role != "user":
            continue
        for block in event.blocks:
            if block.text is not None:
                collapsed = _collapse_whitespace(block.text)
                if collapsed:
                    return collapsed
    return None


def _collapse_whitespace(text: str) -> str:
    return " ".join(text.split())[:80]


# --- write --------------------------------------------------------------------------


def write(session: UniversalSession, output: Path) -> Path:
    """Materialise the IR as a Claude session, returning the session file (`claude::write`).

    `output` is either a `.jsonl` file (written standalone) or a Claude home directory
    (session written under `projects/<slug>/<id>.jsonl`, history appended).
    """
    session_file, history_file = _plan_output(session, output)
    parent = session_file.parent
    if str(parent):
        with ctx(lambda: f"failed to create {parent}"):
            parent.mkdir(parents=True, exist_ok=True)

    session_id = _claude_session_id(session.metadata.session_id)
    cwd = session.metadata.cwd if session.metadata.cwd is not None else "."
    git_branch = (
        session.metadata.git_branch
        if session.metadata.git_branch is not None
        else "HEAD"
    )
    created_at = session.metadata.created_at
    if created_at is None:
        times = [e.timestamp for e in session.events if e.timestamp is not None]
        created_at = min(times) if times else None
    version = CLAUDE_CODE_VERSION

    with ctx(lambda: f"failed to create Claude session {session_file}"):
        handle = open(session_file, "w", encoding="utf-8", newline="\n")

    try:
        previous_uuid: str | None = None
        tool_call_to_uuid: dict[str, str] = {}

        for event in session.events:
            match event:
                case MessageEvent():
                    event_uuid = new_uuid4()
                    projected_role, projected_blocks = _project_message_for_claude(
                        event
                    )
                    content = _encode_message_blocks(projected_blocks)
                    if content is None:
                        continue

                    if projected_role == "assistant":
                        assistant_message = _claude_assistant_message(content, None)
                        line = {
                            "parentUuid": previous_uuid,
                            "isSidechain": False,
                            "userType": "external",
                            "entrypoint": "cli",
                            "cwd": cwd,
                            "sessionId": session_id,
                            "version": version,
                            "gitBranch": git_branch,
                            "message": assistant_message,
                            "type": "assistant",
                            "uuid": event_uuid,
                            "timestamp": _event_timestamp(event.timestamp),
                        }
                    else:
                        line = {
                            "parentUuid": previous_uuid,
                            "isSidechain": False,
                            "userType": "external",
                            "entrypoint": "cli",
                            "cwd": cwd,
                            "sessionId": session_id,
                            "version": version,
                            "gitBranch": git_branch,
                            "type": "user",
                            "message": {"role": "user", "content": content},
                            "uuid": event_uuid,
                            "timestamp": _event_timestamp(event.timestamp),
                            "permissionMode": "default",
                        }
                    write_json_line(handle, line)
                    previous_uuid = event_uuid
                case ReasoningEvent():
                    event_uuid = new_uuid4()
                    content = [
                        {"type": "thinking", "thinking": text}
                        for text in event.summary
                    ]
                    assistant_message = _claude_assistant_message(content, None)
                    line = {
                        "parentUuid": previous_uuid,
                        "isSidechain": False,
                        "userType": "external",
                        "entrypoint": "cli",
                        "cwd": cwd,
                        "sessionId": session_id,
                        "version": version,
                        "gitBranch": git_branch,
                        "message": assistant_message,
                        "type": "assistant",
                        "uuid": event_uuid,
                        "timestamp": _event_timestamp(event.timestamp),
                    }
                    write_json_line(handle, line)
                    previous_uuid = event_uuid
                case ToolCallEvent():
                    event_uuid = new_uuid4()
                    assistant_message = _claude_assistant_message(
                        [
                            {
                                "type": "tool_use",
                                "id": event.call_id,
                                "name": event.name,
                                "input": _encode_tool_input(event.arguments),
                                "caller": {"type": "direct"},
                            }
                        ],
                        "tool_use",
                    )
                    line = {
                        "parentUuid": previous_uuid,
                        "isSidechain": False,
                        "userType": "external",
                        "entrypoint": "cli",
                        "cwd": cwd,
                        "sessionId": session_id,
                        "version": version,
                        "gitBranch": git_branch,
                        "message": assistant_message,
                        "type": "assistant",
                        "uuid": event_uuid,
                        "timestamp": _event_timestamp(event.timestamp),
                    }
                    write_json_line(handle, line)
                    tool_call_to_uuid[event.call_id] = event_uuid
                    previous_uuid = event_uuid
                case ToolResultEvent():
                    event_uuid = new_uuid4()
                    source_uuid = tool_call_to_uuid.get(event.call_id)
                    line = {
                        "parentUuid": previous_uuid,
                        "isSidechain": False,
                        "userType": "external",
                        "entrypoint": "cli",
                        "cwd": cwd,
                        "sessionId": session_id,
                        "version": version,
                        "gitBranch": git_branch,
                        "type": "user",
                        "message": {
                            "role": "user",
                            "content": [
                                {
                                    "type": "tool_result",
                                    "tool_use_id": event.call_id,
                                    "content": _encode_tool_result_output(event.output),
                                    "is_error": event.is_error,
                                }
                            ],
                        },
                        "uuid": event_uuid,
                        "timestamp": _event_timestamp(event.timestamp),
                        "toolUseResult": _tool_result_summary(
                            event.output, event.is_error
                        ),
                        "sourceToolAssistantUUID": source_uuid,
                    }
                    write_json_line(handle, line)
                    previous_uuid = event_uuid
    finally:
        handle.close()

    if history_file is not None:
        history_parent = history_file.parent
        if str(history_parent):
            with ctx(lambda: f"failed to create {history_parent}"):
                history_parent.mkdir(parents=True, exist_ok=True)

        title = _derive_title(session)
        stamp = created_at if created_at is not None else now_utc()
        with ctx(lambda: f"failed to open {history_file}"):
            with open(history_file, "a", encoding="utf-8", newline="\n") as history:
                write_json_line(
                    history,
                    {
                        "display": title
                        if title is not None
                        else "Imported session",
                        "pastedContents": {},
                        "timestamp": timestamp_millis(stamp),
                        "project": cwd,
                        "sessionId": session_id,
                    },
                )

    return session_file


def _plan_output(
    session: UniversalSession, output: Path
) -> tuple[Path, Path | None]:
    """`plan_output`: pick the session-file path and optional history file."""
    if output.suffix == ".jsonl":
        return output, None

    cwd = session.metadata.cwd if session.metadata.cwd is not None else "."
    slug = _path_to_claude_slug(cwd)
    session_id = _claude_session_id(session.metadata.session_id)
    session_file = output / "projects" / slug / f"{session_id}.jsonl"
    history_file = output / "history.jsonl"
    return session_file, history_file


def _path_to_claude_slug(path: str) -> str:
    slug = "".join(ch if ch.isascii() and ch.isalnum() else "-" for ch in path)
    return slug if slug.startswith("-") else f"-{slug}"


def _encode_message_blocks(blocks: list[ContentBlock]) -> list[Any] | None:
    if not blocks:
        return None

    encoded: list[Any] = []
    for block in blocks:
        if block.kind == "input_image":
            image_url = _as_str(_get(block.data, "image_url"))
            if image_url is not None:
                encoded.append(_encode_claude_image(image_url))
                continue

        obj: dict[str, Any] = {"type": _claude_block_kind(block.kind)}
        if block.text is not None:
            text_key = "thinking" if block.kind == "thinking" else "text"
            obj[text_key] = block.text
        if block.data is not None:
            if isinstance(block.data, dict):
                obj.update(block.data)
            else:
                obj["data"] = block.data
        encoded.append(obj)
    return encoded


def _claude_assistant_message(content: Any, stop_reason: Any) -> dict[str, Any]:
    return {
        "id": f"msg_{new_uuid4_simple()}",
        "type": "message",
        "role": "assistant",
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
    }


def _encode_tool_input(input_value: JsonValue) -> Any:
    if isinstance(input_value, dict):
        return input_value
    return {"input": input_value}


def _encode_tool_result_output(output: JsonValue) -> Any:
    if isinstance(output, str):
        return output
    if isinstance(output, list) and output:
        encoded: list[Any] = []
        for item in output:
            match _as_str(_get(item, "type")):
                case "input_text" | "output_text":
                    text = _as_str(_get(item, "text"))
                    encoded.append(
                        {"type": "text", "text": text if text is not None else ""}
                    )
                case "input_image":
                    image_url = _as_str(_get(item, "image_url"))
                    if image_url is None:
                        return _json_to_string(output)
                    encoded.append(_encode_claude_image(image_url))
                case "text" | "image" | "document":
                    encoded.append(item)
                case _:
                    return _json_to_string(output)
        return encoded
    return _json_to_string(output)


def _encode_claude_image(image_url: str) -> dict[str, Any]:
    if image_url.startswith("data:"):
        data_url = image_url[len("data:") :]
        if ";base64," in data_url:
            media_type, data = data_url.split(";base64,", 1)
            return {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": data,
                },
            }

    return {
        "type": "image",
        "source": {"type": "url", "url": image_url},
    }


def _tool_result_summary(output: JsonValue, is_error: bool) -> Any:
    if is_error:
        return _json_to_string(output)

    if isinstance(output, str):
        return {
            "stdout": output,
            "stderr": "",
            "interrupted": False,
            "isImage": False,
            "noOutputExpected": False,
        }
    return {"value": output}


def _event_timestamp(timestamp: datetime | None) -> str:
    return format_millis(timestamp if timestamp is not None else now_utc())


def _claude_session_id(candidate: str) -> str:
    normalized = normalize_uuid(candidate)
    return normalized if normalized is not None else new_uuid4()


def _json_to_string(value: JsonValue) -> str:
    if isinstance(value, str):
        return value
    return dumps_compact(value)


def _project_message_for_claude(
    message: MessageEvent,
) -> tuple[str, list[ContentBlock]]:
    if message.role == "assistant":
        return "assistant", list(message.blocks)
    if message.role == "user":
        return "user", list(message.blocks)

    blocks = list(message.blocks)
    prefix = f"[handoff imported {message.role} message]"
    if blocks and blocks[0].text is not None:
        first = blocks[0]
        blocks[0] = dataclasses.replace(first, text=f"{prefix}\n{first.text}")
    else:
        blocks.insert(0, ContentBlock.make_text("text", prefix))
    return "user", blocks


def _claude_block_kind(kind: str) -> str:
    match kind:
        case "thinking":
            return "thinking"
        case "image":
            return "image"
        case "tool_use":
            return "tool_use"
        case "tool_result":
            return "tool_result"
        case _:
            return "text"
