"""UUID helpers, including a UUIDv7 fallback.

The Rust original uses the `uuid` crate: `Uuid::new_v4()`, `Uuid::now_v7()`,
`Uuid::new_v4().simple()` (32 hex chars, no hyphens) and `Uuid::parse_str(...)`.

Python's stdlib `uuid` gained `uuid7()` only in 3.14; this port targets >=3.12, so
`new_uuid7()` is a hand-rolled RFC 9562 implementation used unconditionally for
determinism across versions. All emitted forms are lowercase, matching the `uuid`
crate's `Display`.
"""

from __future__ import annotations

import os
import time
import uuid

__all__ = [
    "is_uuid",
    "new_uuid4",
    "new_uuid4_simple",
    "new_uuid7",
    "normalize_uuid",
]


def new_uuid4() -> str:
    """Random UUIDv4, canonical hyphenated lowercase (`Uuid::new_v4().to_string()`)."""
    return str(uuid.uuid4())


def new_uuid4_simple() -> str:
    """Random UUIDv4 as 32 hex chars, no hyphens (`Uuid::new_v4().simple()`)."""
    return uuid.uuid4().hex


def new_uuid7() -> str:
    """Time-ordered UUIDv7, canonical hyphenated lowercase (`Uuid::now_v7().to_string()`).

    RFC 9562 layout: 48-bit big-endian Unix-epoch milliseconds, version nibble 7,
    variant bits 0b10, remaining bits random.
    """
    unix_ms = time.time_ns() // 1_000_000
    rand = int.from_bytes(os.urandom(10), "big")  # 74 random bits available

    value = (unix_ms & 0xFFFFFFFFFFFF) << 80
    value |= 0x7 << 76  # version 7
    value |= ((rand >> 62) & 0xFFF) << 64  # rand_a (12 bits)
    value |= 0b10 << 62  # variant
    value |= rand & 0x3FFFFFFFFFFFFFFF  # rand_b (62 bits)
    return str(uuid.UUID(int=value))


def _parse_uuid(candidate: str) -> uuid.UUID | None:
    """Parse `candidate` with the `uuid` crate's `Uuid::parse_str` strictness.

    Stdlib `uuid.UUID` is far more lenient: it strips *all* hyphens and braces before
    checking, so mis-hyphenated strings (e.g. ``67e5-5044-10b1-426f-9247-bb680e5fe0c8``)
    parse successfully where Rust rejects them. The crate accepts only four exact forms:
    32-char simple, 36-char hyphenated (hyphens fixed at positions 8/13/18/23),
    ``{...}``-braced hyphenated, and ``urn:uuid:`` hyphenated. Reproduce that here so
    `is_uuid` / `normalize_uuid` agree with Rust on rekey and output-path decisions.
    """
    if not isinstance(candidate, str):
        return None

    text = candidate
    if len(text) == 45 and text.startswith("urn:uuid:"):
        text = text[9:]
    elif len(text) == 38 and text[0] == "{" and text[-1] == "}":
        text = text[1:-1]

    if len(text) == 32:
        hex_digits = text
    elif len(text) == 36:
        if text[8] != "-" or text[13] != "-" or text[18] != "-" or text[23] != "-":
            return None
        hex_digits = text[:8] + text[9:13] + text[14:18] + text[19:23] + text[24:]
    else:
        return None

    try:
        return uuid.UUID(hex=hex_digits)
    except ValueError:
        return None


def is_uuid(candidate: str) -> bool:
    """True if `candidate` parses as a UUID (`Uuid::parse_str(candidate).is_ok()`)."""
    return _parse_uuid(candidate) is not None


def normalize_uuid(candidate: str) -> str | None:
    """Canonical hyphenated lowercase form, or None if not a UUID.

    Mirrors `Uuid::parse_str(candidate).map(|u| u.to_string()).ok()`.
    """
    parsed = _parse_uuid(candidate)
    return str(parsed) if parsed is not None else None
