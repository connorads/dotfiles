"""Shared JSON and timestamp helpers, tuned for byte-level parity with the Rust original.

Two parity rules drive everything here:

1. **Key ordering.** The Rust crate depends on `serde_json` *without* the
   `preserve_order` feature, so `serde_json::Value::Object` is backed by a `BTreeMap`:
   every free-form JSON object it emits has its keys sorted lexicographically,
   recursively. The IR's own `extra` / `metadata` fields are `BTreeMap` too. So any
   free-form JSON value (a `serde_json::Value`) and any `BTreeMap` must serialise with
   sorted keys. Derived struct fields (the IR structs) keep *declaration* order instead
   and are emitted in that order by `ir.py`'s hand-written `to_json_dict` methods.

2. **Encoding.** `serde_json` writes UTF-8 (never backslash-u-escapes non-ASCII), uses
   compact `,`/`:` separators via `to_writer`, and 2-space indentation via
   `to_string_pretty`. `ensure_ascii=False` + explicit separators reproduce this.

Timestamps: `chrono`'s default `Serialize` for `DateTime<Utc>` is its `Debug` form,
i.e. RFC 3339 with the `AutoSi` fraction rule (0, 3, 6 or 9 fractional digits) and a
`Z` suffix -> `format_auto`. The JSONL writers instead pin `SecondsFormat::Millis`
(always 3 digits) + `Z` -> `format_millis`. Parsing mirrors
`DateTime::parse_from_rfc3339(...).with_timezone(&Utc)`.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import IO, Any

__all__ = [
    "parse_datetime",
    "format_millis",
    "format_auto",
    "timestamp_millis",
    "now_utc",
    "sort_value",
    "dumps_compact",
    "dumps_pretty",
    "write_json_line",
]

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def now_utc() -> datetime:
    """Current instant as an aware UTC datetime (`Utc::now()`)."""
    return datetime.now(UTC)


def parse_datetime(value: str) -> datetime | None:
    """Parse an RFC 3339 string to an aware UTC datetime, or None on failure.

    Mirrors `DateTime::parse_from_rfc3339(value).ok().map(|d| d.with_timezone(&Utc))`.

    Deviation: Python datetimes carry microsecond (not nanosecond) resolution, so
    inputs with 7-9 fractional digits are truncated to microseconds.
    """
    text = value.strip()
    for candidate in (text, _trim_fraction_to_micros(text)):
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            return None  # RFC 3339 requires an offset; chrono would reject it too
        return parsed.astimezone(UTC)
    return None


def _trim_fraction_to_micros(text: str) -> str:
    """Trim a fractional-seconds run to at most 6 digits so `fromisoformat` accepts it."""
    dot = text.find(".")
    if dot == -1:
        return text
    end = dot + 1
    while end < len(text) and text[end].isdigit():
        end += 1
    digits = text[dot + 1 : end]
    if len(digits) <= 6:
        return text
    return f"{text[:dot]}.{digits[:6]}{text[end:]}"


def format_millis(value: datetime) -> str:
    """RFC 3339 with millisecond precision and a `Z` suffix.

    Mirrors `to_rfc3339_opts(SecondsFormat::Millis, true)`, used by the JSONL writers.
    """
    dt = value.astimezone(UTC)
    millis = dt.microsecond // 1000
    return f"{_ymd_hms(dt)}.{millis:03d}Z"


def format_auto(value: datetime) -> str:
    """RFC 3339 with `AutoSi` fractional digits and a `Z` suffix.

    Mirrors `chrono`'s default `DateTime<Utc>` serde encoding (its `Debug` form),
    used for the IR `created_at` / `updated_at` fields: no fraction when zero,
    otherwise 3 digits (millisecond-aligned) or 6 digits (microsecond).
    """
    dt = value.astimezone(UTC)
    micro = dt.microsecond
    if micro == 0:
        return f"{_ymd_hms(dt)}Z"
    if micro % 1000 == 0:
        return f"{_ymd_hms(dt)}.{micro // 1000:03d}Z"
    return f"{_ymd_hms(dt)}.{micro:06d}Z"


def timestamp_millis(value: datetime) -> int:
    """Whole milliseconds since the Unix epoch (`DateTime::timestamp_millis`).

    Exact integer arithmetic, matching chrono. `int(value.timestamp() * 1000)` goes
    through a float and can land 1ms low for some millisecond-aligned instants (e.g.
    `2004-06-21T21:40:18.485Z` -> 1087854018484 instead of 1087854018485).
    """
    delta = value.astimezone(UTC) - _EPOCH
    return delta.days * 86_400_000 + delta.seconds * 1_000 + delta.microseconds // 1_000


def _ymd_hms(dt: datetime) -> str:
    return (
        f"{dt.year:04d}-{dt.month:02d}-{dt.day:02d}"
        f"T{dt.hour:02d}:{dt.minute:02d}:{dt.second:02d}"
    )


def sort_value(value: Any) -> Any:
    """Return `value` with every nested object's keys sorted lexicographically.

    Reproduces the `BTreeMap`-backed `serde_json::Value` ordering for free-form JSON
    (block `data`, tool `arguments` / `output`, and the `extra` / `metadata` maps).
    Applied by `ir.py` before pretty-printing, where global `sort_keys` cannot be used
    (it would also reorder the declaration-ordered IR struct fields).
    """
    if isinstance(value, dict):
        return {key: sort_value(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [sort_value(item) for item in value]
    return value


def dumps_compact(value: Any) -> str:
    """Compact JSON, keys sorted, UTF-8 preserved (`serde_json::to_writer` of a `Value`).

    Use for single JSONL lines, where the whole line is free-form JSON.
    """
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def dumps_pretty(value: Any) -> str:
    """2-space-indented JSON, UTF-8 preserved, order preserved (`serde_json::to_string_pretty`).

    Does *not* sort keys: the caller (`ir.py`) emits IR struct fields in declaration
    order and has already `sort_value`-ordered the free-form subtrees. No trailing
    newline, matching `fs::write` of the pretty string.
    """
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False)


def write_json_line(stream: IO[str], value: Any) -> None:
    """Write one compact JSON line + `\\n` (`serde_json::to_writer` then a newline byte)."""
    stream.write(dumps_compact(value))
    stream.write("\n")
