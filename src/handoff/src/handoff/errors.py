"""Error strategy for the handoff port.

The Rust original uses `anyhow`: fallible functions return `anyhow::Result<T>`,
attach human-readable context with `.context(...)` / `.with_context(|| ...)`, and
raise ad-hoc errors with `bail!(...)`. Python has no `Result`, so this port maps
that model onto a single exception type plus a context helper:

- Every expected failure is a `HandoffError`.
- `ctx(...)` is the analogue of anyhow's `.with_context` / `.context`: it wraps any
  exception raised inside its block in a fresh `HandoffError` whose message is
  the new context, chaining the original as `__cause__` (like anyhow's source chain).
- `bail(msg)` is the analogue of `bail!`: raise a `HandoffError` with no source.

This keeps the "translate exceptions into a typed domain error at the shell"
discipline: wrap `OSError`, `json.JSONDecodeError`, `UnicodeDecodeError`, etc. at the
boundary, never let raw stdlib exceptions escape the public API.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import NoReturn

__all__ = ["HandoffError", "bail", "ctx"]


class HandoffError(Exception):
    """The single error type every public handoff function may raise.

    Mirrors an `anyhow::Error`: the top message is the outermost context, and
    `__cause__` walks the chain of wrapped lower-level failures.
    """


def bail(message: str) -> NoReturn:
    """Raise a `HandoffError` with `message` and no underlying cause.

    Analogue of anyhow's `bail!(...)`.
    """
    raise HandoffError(message)


@contextmanager
def ctx(message: str | Callable[[], str]) -> Iterator[None]:
    """Attach context to any failure raised inside the block.

    Analogue of `.with_context(|| ...)` (pass a callable, evaluated only on failure)
    and `.context(...)` (pass a str). Any exception raised inside is re-raised as a
    `HandoffError` carrying `message`, with the original chained as `__cause__`.

    Example (mirrors `fs::read_to_string(path).with_context(|| format!("failed to read {}", path))`)::

        with ctx(lambda: f"failed to read IR file {path}"):
            text = path.read_text(encoding="utf-8")
    """
    try:
        yield
    except Exception as exc:
        text = message() if callable(message) else message
        raise HandoffError(text) from exc
