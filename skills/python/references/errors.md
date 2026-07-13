# Errors and failures

Expected failures are values. Defects raise. Keep the two vocabularies distinct.

## Result shape

Match the repo's existing convention if it has one. The house default is a plain
frozen tagged union consumed with `match` (no library needed):

```python
# result.py — explicit success/failure for the pure core. No raising below the
# imperative shell; every fallible core function returns a Result.
from dataclasses import dataclass

@dataclass(frozen=True, slots=True)
class Ok[T]:
    value: T

@dataclass(frozen=True, slots=True)
class Err[E]:
    error: E

type Result[T, E] = Ok[T] | Err[E]
```

The `class Ok[T]` and `type Result[...] = ...` forms are PEP 695 syntax
(Python 3.12+). On 3.10/3.11, use `T = TypeVar("T")` with `class Ok(Generic[T])`
and a plain `Result = Ok[T] | Err[E]` alias (`match` itself needs 3.10+).

Consume by matching, so a forgotten branch is a type error:

```python
match find_active(email):
    case Ok(user):  ...
    case Err(UserNotFound()):       ...
    case Err(UserStoreUnavailable()): ...
```

Keep error unions precise at module boundaries
(`Result[User, UserNotFound | UserStoreUnavailable]`). Reserve a broad `AppError`
for entrypoints, orchestration, logging, and rendering only.

**Ladder:** repo convention > `returns.Result`/`Maybe` (railway-style `bind`/do
notation, when the repo adopts `returns`) > the local tagged union above >
`T | DomainError`.

## Domain errors named in the ubiquitous language

Expected failures get a tag (the class itself), a useful message, and structured
context. A small common base makes them easy to map at the shell:

```python
class OutOfStock(Exception):
    """No batch can satisfy this order line."""
    def __init__(self, sku: Sku) -> None:
        super().__init__(f"Out of stock for sku {sku}")
        self.sku = sku
```

Whether you *return* these (as `Err(OutOfStock(...))`) or selectively raise them
at the shell, name them for the business outcome, not the mechanism.

## Translate exceptions at the shell

Exceptions are unavoidable at boundaries — `StopIteration`, `KeyError`, ORM
integrity errors, HTTP/socket errors. Catch them at the imperative shell and
translate into a domain value or error; never let an infrastructure exception
leak into the pure core as control flow.

```python
def allocate(line: OrderLine, batches: list[Batch]) -> Reference:
    try:
        batch = next(b for b in sorted(batches) if b.can_allocate(line))
    except StopIteration:
        raise OutOfStock(line.sku) from None  # control-flow signal -> domain error
    batch.allocate(line)
    return batch.reference
```

Preserve the cause (`raise ... from err`) when wrapping an unexpected
infrastructure failure. Keep the happy path readable.

## Panic vocabulary — defects raise

Defects are bugs and impossible states: raise and let them crash, caught once at
the top.

- `raise NotImplementedError` for stubs.
- `assert_never(x)` on an exhaustive `match` catch-all (a forgotten variant is a
  type error, see `modeling.md`).
- A bare `assert` documents an invariant in dev, but it is stripped under `-O` —
  never use it for input validation or security checks; parse instead.

Reserve docstrings' failure notes for these defect paths, never for expected
typed errors.

## Sensitive values

Never put secrets (tokens, keys, passwords) in errors, traces, logs, or
snapshots. Wrap them at the boundary — pydantic's `SecretStr`, or a small
`Redacted` wrapper whose `__repr__`/`__str__` masks the value — and unwrap only
inside the adapter making the external call. Telemetry carries safe fields only:
domain ids, operation names, provider names, state tags, error tags.
(Observability principle: `architecture`.)
