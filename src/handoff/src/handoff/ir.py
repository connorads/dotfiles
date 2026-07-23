"""The universal intermediate representation (IR).

Direct port of `src/ir.rs`. The IR is the hub format: Codex and Claude sessions load
into a `UniversalSession`, and any target materialises from one.

Serialisation parity notes (see `_json.py` for the mechanics):

- IR struct fields serialise in *declaration* order (serde derive), reproduced by the
  hand-written `to_json_dict` methods here.
- `Option` fields are omitted when `None` (`skip_serializing_if = "Option::is_none"`).
- `extra` / event `metadata` are `BTreeMap`s: omitted when empty, keys sorted.
- Free-form JSON (`ContentBlock.data`, `ToolCallEvent.arguments`,
  `ToolResultEvent.output`, and every value inside `extra` / `metadata`) is sorted via
  `sort_value`, matching the `BTreeMap`-backed `serde_json::Value`.
- `SessionEvent` is internally tagged on `kind` (snake_case), with `kind` emitted first.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any

from ._json import format_auto, parse_datetime, sort_value
from .errors import HandoffError

__all__ = [
    "CURRENT_IR_VERSION",
    "ContentBlock",
    "JsonValue",
    "MessageEvent",
    "ReasoningEvent",
    "SessionEvent",
    "SessionFormat",
    "SessionMetadata",
    "SourceFormat",
    "ToolCallEvent",
    "ToolResultEvent",
    "UniversalSession",
    "event_from_json_dict",
    "event_timestamp",
    "event_to_json_dict",
]

type JsonValue = None | bool | int | float | str | list[Any] | dict[str, Any]

CURRENT_IR_VERSION = "handoff/v1"
"""`UniversalSession::CURRENT_IR_VERSION`."""


class SessionFormat(StrEnum):
    """A concrete session format (`SessionFormat`, serde `snake_case`)."""

    IR = "ir"
    CODEX = "codex"
    CLAUDE = "claude"


class SourceFormat(StrEnum):
    """A requested source format, where `AUTO` means "detect" (`SourceFormat`)."""

    AUTO = "auto"
    IR = "ir"
    CODEX = "codex"
    CLAUDE = "claude"

    def explicit(self) -> SessionFormat | None:
        """The concrete format, or None for `AUTO` (`SourceFormat::explicit`)."""
        match self:
            case SourceFormat.AUTO:
                return None
            case SourceFormat.IR:
                return SessionFormat.IR
            case SourceFormat.CODEX:
                return SessionFormat.CODEX
            case SourceFormat.CLAUDE:
                return SessionFormat.CLAUDE


# --- serde helpers -----------------------------------------------------------------


def _parse_dt(raw: object, field_name: str) -> datetime | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise HandoffError(f"expected RFC 3339 string for {field_name}")
    parsed = parse_datetime(raw)
    if parsed is None:
        raise HandoffError(f"invalid RFC 3339 timestamp for {field_name}: {raw!r}")
    return parsed


def _sorted_map(raw: object) -> dict[str, Any]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise HandoffError("expected a JSON object")
    return dict(raw)


# --- content block -----------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ContentBlock:
    """One block of message content (`ContentBlock`)."""

    kind: str
    text: str | None = None
    data: JsonValue | None = None

    @classmethod
    def make_text(cls, kind: str, text: str) -> ContentBlock:
        """A text block (`ContentBlock::text`)."""
        return cls(kind=kind, text=text, data=None)

    def to_json_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"kind": self.kind}
        if self.text is not None:
            out["text"] = self.text
        if self.data is not None:
            out["data"] = sort_value(self.data)
        return out

    @classmethod
    def from_json_dict(cls, value: dict[str, Any]) -> ContentBlock:
        kind = value.get("kind")
        if not isinstance(kind, str):
            raise HandoffError("content block is missing a string 'kind'")
        text = value.get("text")
        if text is not None and not isinstance(text, str):
            raise HandoffError("content block 'text' must be a string")
        return cls(kind=kind, text=text, data=value.get("data"))


# --- events ------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class MessageEvent:
    """A message from a participant (`MessageEvent`, `kind = "message"`)."""

    role: str
    id: str | None = None
    parent_id: str | None = None
    timestamp: datetime | None = None
    blocks: list[ContentBlock] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    KIND = "message"

    def to_json_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"kind": self.KIND}
        if self.id is not None:
            out["id"] = self.id
        if self.parent_id is not None:
            out["parent_id"] = self.parent_id
        out["role"] = self.role
        if self.timestamp is not None:
            out["timestamp"] = format_auto(self.timestamp)
        out["blocks"] = [block.to_json_dict() for block in self.blocks]
        if self.metadata:
            out["metadata"] = sort_value(self.metadata)
        return out

    @classmethod
    def from_json_dict(cls, value: dict[str, Any]) -> MessageEvent:
        role = value.get("role")
        if not isinstance(role, str):
            raise HandoffError("message event is missing a string 'role'")
        if "blocks" not in value:
            raise HandoffError("message event is missing 'blocks'")
        blocks_raw = value["blocks"]
        if not isinstance(blocks_raw, list):
            raise HandoffError("message 'blocks' must be an array")
        return cls(
            role=role,
            id=value.get("id"),
            parent_id=value.get("parent_id"),
            timestamp=_parse_dt(value.get("timestamp"), "timestamp"),
            blocks=[ContentBlock.from_json_dict(block) for block in blocks_raw],
            metadata=_sorted_map(value.get("metadata")),
        )


@dataclass(frozen=True, slots=True)
class ReasoningEvent:
    """A reasoning / thinking summary (`ReasoningEvent`, `kind = "reasoning"`)."""

    id: str | None = None
    parent_id: str | None = None
    timestamp: datetime | None = None
    summary: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    KIND = "reasoning"

    def to_json_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"kind": self.KIND}
        if self.id is not None:
            out["id"] = self.id
        if self.parent_id is not None:
            out["parent_id"] = self.parent_id
        if self.timestamp is not None:
            out["timestamp"] = format_auto(self.timestamp)
        out["summary"] = list(self.summary)
        if self.metadata:
            out["metadata"] = sort_value(self.metadata)
        return out

    @classmethod
    def from_json_dict(cls, value: dict[str, Any]) -> ReasoningEvent:
        if "summary" not in value:
            raise HandoffError("reasoning event is missing 'summary'")
        summary_raw = value["summary"]
        if not isinstance(summary_raw, list):
            raise HandoffError("reasoning 'summary' must be an array")
        return cls(
            id=value.get("id"),
            parent_id=value.get("parent_id"),
            timestamp=_parse_dt(value.get("timestamp"), "timestamp"),
            summary=[str(item) for item in summary_raw],
            metadata=_sorted_map(value.get("metadata")),
        )


@dataclass(frozen=True, slots=True)
class ToolCallEvent:
    """A tool / function invocation (`ToolCallEvent`, `kind = "tool_call"`)."""

    call_id: str
    name: str
    id: str | None = None
    parent_id: str | None = None
    timestamp: datetime | None = None
    arguments: JsonValue = None
    metadata: dict[str, Any] = field(default_factory=dict)

    KIND = "tool_call"

    def to_json_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"kind": self.KIND}
        if self.id is not None:
            out["id"] = self.id
        if self.parent_id is not None:
            out["parent_id"] = self.parent_id
        out["call_id"] = self.call_id
        out["name"] = self.name
        if self.timestamp is not None:
            out["timestamp"] = format_auto(self.timestamp)
        out["arguments"] = sort_value(self.arguments)
        if self.metadata:
            out["metadata"] = sort_value(self.metadata)
        return out

    @classmethod
    def from_json_dict(cls, value: dict[str, Any]) -> ToolCallEvent:
        call_id = value.get("call_id")
        if not isinstance(call_id, str):
            raise HandoffError("tool_call event is missing a string 'call_id'")
        name = value.get("name")
        if not isinstance(name, str):
            raise HandoffError("tool_call event is missing a string 'name'")
        if "arguments" not in value:
            raise HandoffError("tool_call event is missing 'arguments'")
        return cls(
            call_id=call_id,
            name=name,
            id=value.get("id"),
            parent_id=value.get("parent_id"),
            timestamp=_parse_dt(value.get("timestamp"), "timestamp"),
            arguments=value["arguments"],
            metadata=_sorted_map(value.get("metadata")),
        )


@dataclass(frozen=True, slots=True)
class ToolResultEvent:
    """The result of a tool call (`ToolResultEvent`, `kind = "tool_result"`)."""

    call_id: str
    output: JsonValue = None
    is_error: bool = False
    id: str | None = None
    parent_id: str | None = None
    timestamp: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    KIND = "tool_result"

    def to_json_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"kind": self.KIND}
        if self.id is not None:
            out["id"] = self.id
        if self.parent_id is not None:
            out["parent_id"] = self.parent_id
        out["call_id"] = self.call_id
        if self.timestamp is not None:
            out["timestamp"] = format_auto(self.timestamp)
        out["output"] = sort_value(self.output)
        out["is_error"] = self.is_error
        if self.metadata:
            out["metadata"] = sort_value(self.metadata)
        return out

    @classmethod
    def from_json_dict(cls, value: dict[str, Any]) -> ToolResultEvent:
        call_id = value.get("call_id")
        if not isinstance(call_id, str):
            raise HandoffError("tool_result event is missing a string 'call_id'")
        if "output" not in value:
            raise HandoffError("tool_result event is missing 'output'")
        if "is_error" not in value:
            raise HandoffError("tool_result event is missing 'is_error'")
        is_error = value["is_error"]
        if not isinstance(is_error, bool):
            raise HandoffError("tool_result 'is_error' must be a boolean")
        return cls(
            call_id=call_id,
            output=value["output"],
            is_error=is_error,
            id=value.get("id"),
            parent_id=value.get("parent_id"),
            timestamp=_parse_dt(value.get("timestamp"), "timestamp"),
            metadata=_sorted_map(value.get("metadata")),
        )


type SessionEvent = MessageEvent | ReasoningEvent | ToolCallEvent | ToolResultEvent
"""Internally-tagged event union (`SessionEvent`)."""

_EVENT_BY_KIND: dict[str, type] = {
    MessageEvent.KIND: MessageEvent,
    ReasoningEvent.KIND: ReasoningEvent,
    ToolCallEvent.KIND: ToolCallEvent,
    ToolResultEvent.KIND: ToolResultEvent,
}


def event_to_json_dict(event: SessionEvent) -> dict[str, Any]:
    """Encode any event to its `{"kind": ...}` JSON object."""
    return event.to_json_dict()


def event_from_json_dict(value: dict[str, Any]) -> SessionEvent:
    """Decode a `{"kind": ...}` JSON object into the matching event dataclass."""
    kind = value.get("kind")
    if not isinstance(kind, str):
        raise HandoffError("session event is missing a string 'kind'")
    cls = _EVENT_BY_KIND.get(kind)
    if cls is None:
        raise HandoffError(f"unknown session event kind: {kind!r}")
    return cls.from_json_dict(value)


def event_timestamp(event: SessionEvent) -> datetime | None:
    """The event's timestamp, if any (`SessionEvent::timestamp`)."""
    return event.timestamp


# --- metadata & session ------------------------------------------------------------


@dataclass(slots=True)
class SessionMetadata:
    """Session-level metadata (`SessionMetadata`).

    Mutable: loaders build it up field-by-field across many input lines, mirroring the
    Rust `&mut SessionMetadata`.
    """

    session_id: str
    source_format: SessionFormat | None = None
    original_session_id: str | None = None
    title: str | None = None
    cwd: str | None = None
    git_branch: str | None = None
    model: str | None = None
    platform_version: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def new(cls, session_id: str) -> SessionMetadata:
        """Empty metadata for `session_id` (`SessionMetadata::new`)."""
        return cls(session_id=session_id)

    def to_json_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"session_id": self.session_id}
        if self.source_format is not None:
            out["source_format"] = self.source_format.value
        if self.original_session_id is not None:
            out["original_session_id"] = self.original_session_id
        if self.title is not None:
            out["title"] = self.title
        if self.cwd is not None:
            out["cwd"] = self.cwd
        if self.git_branch is not None:
            out["git_branch"] = self.git_branch
        if self.model is not None:
            out["model"] = self.model
        if self.platform_version is not None:
            out["platform_version"] = self.platform_version
        if self.created_at is not None:
            out["created_at"] = format_auto(self.created_at)
        if self.updated_at is not None:
            out["updated_at"] = format_auto(self.updated_at)
        if self.extra:
            out["extra"] = sort_value(self.extra)
        return out

    @classmethod
    def from_json_dict(cls, value: dict[str, Any]) -> SessionMetadata:
        session_id = value.get("session_id")
        if not isinstance(session_id, str):
            raise HandoffError("metadata is missing a string 'session_id'")
        source_raw = value.get("source_format")
        source_format = SessionFormat(source_raw) if source_raw is not None else None
        return cls(
            session_id=session_id,
            source_format=source_format,
            original_session_id=value.get("original_session_id"),
            title=value.get("title"),
            cwd=value.get("cwd"),
            git_branch=value.get("git_branch"),
            model=value.get("model"),
            platform_version=value.get("platform_version"),
            created_at=_parse_dt(value.get("created_at"), "created_at"),
            updated_at=_parse_dt(value.get("updated_at"), "updated_at"),
            extra=_sorted_map(value.get("extra")),
        )


@dataclass(slots=True)
class UniversalSession:
    """A whole session in IR form (`UniversalSession`)."""

    ir_version: str
    metadata: SessionMetadata
    events: list[SessionEvent] = field(default_factory=list)

    CURRENT_IR_VERSION = CURRENT_IR_VERSION

    @classmethod
    def new(cls, session_id: str) -> UniversalSession:
        """A fresh session with current IR version (`UniversalSession::new`)."""
        return cls(
            ir_version=CURRENT_IR_VERSION,
            metadata=SessionMetadata.new(session_id),
            events=[],
        )

    def to_json_dict(self) -> dict[str, Any]:
        return {
            "ir_version": self.ir_version,
            "metadata": self.metadata.to_json_dict(),
            "events": [event_to_json_dict(event) for event in self.events],
        }

    @classmethod
    def from_json_dict(cls, value: dict[str, Any]) -> UniversalSession:
        ir_version = value.get("ir_version")
        if not isinstance(ir_version, str):
            raise HandoffError("IR is missing a string 'ir_version'")
        metadata_raw = value.get("metadata")
        if not isinstance(metadata_raw, dict):
            raise HandoffError("IR is missing a 'metadata' object")
        if "events" not in value:
            raise HandoffError("IR is missing 'events'")
        events_raw = value["events"]
        if not isinstance(events_raw, list):
            raise HandoffError("IR 'events' must be an array")
        return cls(
            ir_version=ir_version,
            metadata=SessionMetadata.from_json_dict(metadata_raw),
            events=[event_from_json_dict(event) for event in events_raw],
        )
