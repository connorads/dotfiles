---
name: python
description: >
  Write idiomatic, type-safe Python: errors as values (Result/typed errors) and
  composing them, parse-don't-validate with pydantic, frozen kw-only dataclass
  value objects, unions with match and assert_never (structural pattern
  matching), Protocol vs ABC ports, persistence-ignorant domain models, package
  layout, import discipline and circular imports, config parsed once at a
  composition root that is a scope (DI/bootstrap), structured concurrency with
  asyncio task groups and retries, smart constructors, which interpreter and
  library versions to target, basedpyright, and the Any/cast/type-ignore
  discipline. Use when designing or reviewing Python specifically. Routing:
  architecture for agnostic design, mechanical-enforcement for lint and
  type-checker config, testing for test strategy.
---

# Python

Concrete Python idioms that make the `architecture` skill's principles
correct-by-construction: the *how* in Python, not the agnostic *why* or the
enforceable config - see routing.

## Routing - who owns what

| Concern | Owner | This skill |
|---|---|---|
| Agnostic principles (functional core/shell, ports, errors as values, observability, idempotency, the config lifetimes) | `architecture` (`references/configuration-lifecycle.md` for config) | states the Python idiom + why, points here |
| ruff format/lint, basedpyright `recommended`, no-`Any`, vulture, import-linter / tach contracts, purity bans, pytest strictness | `mechanical-enforcement` (`references/python.md`) | names the idiom, points there for config |
| Test strategy, layers, fakes-not-mocks, property tests | `testing` | Python specifics only (pytest, hypothesis, no `mock.patch`) |
| Coverage thresholds, mutation, CI/hook enforcement | `test-coverage` | - |
| Structured logging | `logging-best-practices` (`references/python.md`) | points there |

Rule: state the idiom and its *why* here, point out for the rest, and never copy
their tables.

## Adapt first

Read the repo first. These are defaults for greenfield or where the repo has no
convention - not a migration mandate.

```text
Does the repo already have a convention for this concern?
|-- errors  -> its exception hierarchy or Result/returns convention; no rival
|-- schema  -> its parser (pydantic / msgspec / attrs+cattrs); no second one
|-- typing  -> its checker (mypy vs basedpyright) and strictness first
|-- modules -> its src-layout and import style before "fixing" it
|-- tests   -> its runner (pytest) and double strategy
`-- none    -> the defaults here; integrate, don't migrate
```

Priority when rules pull apart: correctness/safety > existing conventions >
better local design > avoiding broad migrations > documenting the trade-off. A
new code path follows these standards; an unrelated change migrates nothing.

**Version floor.** Every snippet is Python 3.12+ (PEP 695 generics, `type`
aliases) and 3.14 is the default for new work; `references/toolchain.md` owns the
floor, the idiom-to-version table and every dated library fact. Much of the
Cosmic-Python canon (raw dataclasses, exception-first flow) predates pydantic v2,
`match` and basedpyright - prefer the modern idiom.

## Core idioms

### Errors as values

Expected failures - domain, parsing, auth, persistence - belong in the return
type, not a raised exception: a signature is the only failure contract a caller
reads.

```python
def find_active(email: EmailAddress) -> Result[ActiveUser, UserLookupError]: ...
```

Which `Result` is a type-checker decision, raising is for defects, and a
boundary exception translates at the shell. See `references/errors.md`.

### Composing fallible steps

Chain with `map_ok`/`and_then` while a step needs only its predecessor, ladder
with early returns once one needs more, and let private steps raise so the public
seam translates once - each error mapped into one declared channel, or it grows
a member per step. See `references/errors.md`.

### Make signatures total and honest

Constrain the input to a parsed or `NewType` value, or widen the output to
`Result`; constraining is better, deleting the branch for every caller. `None` is
no error channel, and a `None` default hides two operations in one. See
`references/parsing.md`.

### Parse, don't validate

Turn untrusted or loosely-typed input into domain types once at the boundary and
keep the refined type - rows and config included, since nothing inbound is
trusted. Boundary models carry `ConfigDict(strict=True, extra="forbid")`, a
control no linter substitutes for. See `references/parsing.md`.

### Make illegal states unrepresentable

A lifecycle is a union of frozen dataclasses, not a bag of `is_x` booleans, and a
closed set is a `Literal` or `StrEnum`: class patterns plus `assert_never`
exhaust the union with no tag field.

```python
match inv:
    case Draft():          ...
    case Sent(sent_at=at): ...
    case _:                assert_never(inv)  # new variant -> type error
```

Named options or domain types replace boolean behaviour flags. See
`references/modeling.md`.

### Value objects and entities

`@dataclass(frozen=True, slots=True, kw_only=True)` is the house value object -
value-equality, hashability, no positional swaps - and an entity is
`@dataclass(eq=False)` with a hand-written `__eq__` over its stable id. Every
flag also charges: `frozen` blocks rebinding, not mutation. See
`references/modeling.md`.

### Branded primitives - and where the advice stops

`typing.NewType` brands statically only and every parser erases it, so it fits an
id whose one rule is "do not mix these up", while an `Annotated` alias carries a
rule the boundary applies; a plain `str`/`int` is right where a wrapper is
ceremony. See `references/parsing.md`.

### Deep modules and a public surface

One package per bounded context under `src/`, `__init__.py` its only importable
surface marked by `__all__` or an `X as X` re-export, absolute imports
throughout. Keep it thin and free of import-time side effects: importing a
package executes every submodule it re-exports. See `references/modules.md`.

### Protocol over ABC for ports

A `typing.Protocol` naming the narrowest shape a caller needs is the default
port, since an adapter satisfies it by shape with no subclassing, and a
single-method port is a plain `Callable`. `abc.ABC` is for nominal enforcement
or shared behaviour only. See `references/ports-persistence.md`.

### Persistence ignorance

Domain classes stay plain objects with no ORM base class - SQLAlchemy's
imperative mapping makes the ORM import the model, not the reverse - and
aggregates link by id, never by embedding. Watch `SELECT N+1` on a lazy-loaded
graph. See `references/ports-persistence.md`.

### Configuration and a composition root that is a scope

Parse config once at the composition root into a frozen typed value
(`pydantic-settings`, `SecretStr`) and refuse to start on bad config; nothing
outside `bootstrap()` touches `os.environ`. The root is an
`@asynccontextmanager` over an `AsyncExitStack`, which releases in exact reverse
of acquisition. See `references/ports-persistence.md`.

### Resource and transaction boundaries

A `with` block carries a transaction or resource scope - the Unit of Work is
`with uow:`. Rollback is the default, so the only path that persists is total
success plus an explicit `commit()`. See `references/ports-persistence.md`.

### Structured concurrency

Every task has an owner: spawn only inside `asyncio.TaskGroup` or an anyio task
group, since a bare `create_task` is weakly referenced and can be collected
before it runs. A child's failure arrives wrapped in an `ExceptionGroup` even
when alone, so unwrap at the shell. See `references/concurrency.md`.

### The Any / cast / type-ignore discipline

Config is `mechanical-enforcement`'s; the idioms: no bare `Any`, `cast()` only
under a `# SAFETY:` comment, a rule-coded `# pyright: ignore[reportX]` so
suppressions expire, `assert_never` on exhaustive matches, `Self`, `@override`,
`@final` and `@warnings.deprecated` where they apply, and
`Sequence`/`Mapping`/`Iterable` parameters against concrete returns. See
`references/conventions.md`.

## References

- `references/errors.md` - `Result` shape, composition, error naming, translation at the shell.
- `references/parsing.md` - schema ladder, strict boundaries, smart constructors, brands, optionality.
- `references/modeling.md` - record-type chooser, illegal states, the house dataclass, entities.
- `references/modules.md` - deep modules, layout, public surface, import-time effects, cycles.
- `references/ports-persistence.md` - Protocol vs ABC, persistence, config, composition root, retries, clock.
- `references/concurrency.md` - task ownership, exception groups, cancellation, streams, back-pressure.
- `references/toolchain.md` - floor and default, idiom-to-version table, uv, free-threading, library facts.
- `references/conventions.md` - `Any`/`cast`/`type-ignore`, narrowing, collections, pytest.
