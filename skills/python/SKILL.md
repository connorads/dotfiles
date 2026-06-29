---
name: python
description: >
  Write idiomatic, type-safe Python: errors as values, parse-don't-validate with
  pydantic, frozen-dataclass value objects, tagged unions with match, Protocol
  ports, persistence-ignorant domain models, and the Any/cast/type-ignore
  discipline. Use when designing or reviewing Python specifically — Result/typed
  errors, pydantic boundaries, dataclasses, Protocol vs ABC, structural pattern
  matching, smart constructors, DI/bootstrap, or strict pyright. For
  language-agnostic design use the architecture skill; for ruff/pyright config use
  mechanical-enforcement; for test strategy use testing.
---

# Python

Concrete Python idioms that make the principles from the `architecture` skill
correct-by-construction. This skill owns the *how* in Python; it does not restate
the agnostic *why* or the enforceable lint/type-checker config — see routing.

## Routing — who owns what

| Concern | Owner | This skill |
|---|---|---|
| Agnostic principles (functional core/shell, ports, error-as-value concept, observability, workflows/idempotency, config-at-boundary) | `architecture` | states the Python idiom + why, points here |
| ruff format/lint, basedpyright/pyright strict, no-`Any`, vulture | `mechanical-enforcement` | names the idiom, points there for config |
| Test strategy, layers, fakes-not-mocks, property tests | `testing` | Python specifics only (pytest, hypothesis, no `mock.patch`) |
| Coverage thresholds, mutation, CI/hook enforcement | `test-coverage` | — |
| Structured logging | `logging-best-practices` (`references/python.md`) | points there |

Rule: state the idiom and *why* it exists here; point out for the agnostic
principle or the enforceable config. Never copy their tables.

## Adapt first

Before applying anything below, read the repo. These are defaults for greenfield
or where the repo has no convention — not a migration mandate.

```text
Does the repo already have a convention for this concern?
|-- errors    -> use its exception hierarchy or Result/returns convention; don't introduce a rival
|-- schema    -> match its parser (pydantic / msgspec / attrs+cattrs); don't add another
|-- typing    -> match its checker (mypy vs basedpyright) and strictness before tightening
|-- modules   -> match its src-layout and import style before "fixing" it
|-- tests     -> match its runner (pytest) and double strategy
`-- none / greenfield -> apply the defaults here; integrate, don't migrate
```

Decision priority when rules pull apart: correctness/safety > existing project
conventions > improving local design > avoid broad migrations > document the
trade-off. New code paths follow these standards; do not force a whole-project
migration for an unrelated change.

**Modern-Python note.** The aspirational top of every ladder here is pydantic v2
at the boundary, errors-as-values (`returns` or a hand-rolled `Ok | Err` union
consumed with `match`), structural pattern matching with `assert_never`, and
strict basedpyright. Below 3.10, or before a repo adopts these, the hand-rolled
defaults apply. Much of the Cosmic-Python canon (raw dataclasses, exception-first
flow) predates them — prefer the modern idiom in new code.

## Core idioms

### Errors as values

Python defaults to exceptions, but expected failures (domain, parsing, auth,
persistence) belong in the return type, not a raised exception.

```python
def find_active(email: EmailAddress) -> Result[ActiveUser, UserLookupError]: ...
# not: -> ActiveUser that raises for an ordinary missing user
```

Ladder: repo convention > `returns.Result`/`Maybe` (if adopted) > a hand-rolled
frozen-dataclass `Ok | Err` union consumed with `match` > a `T | DomainError`
union. Raising is for *defects* only: violated invariants, impossible branches,
startup misconfiguration, `raise NotImplementedError`.

The honest Python nuance the TypeScript sibling lacks: exceptions are unavoidable
at boundaries (`StopIteration`, `KeyError`, ORM integrity errors). Catch and
*translate* them into domain values/errors at the shell (`next(...)` raising
`StopIteration` becomes an `OutOfStock` domain error), never deep in the core.
See `references/errors.md` for the `Result` shape, domain exceptions named in the
ubiquitous language, and the translate-at-the-shell pattern.

### Parse, don't validate

Turn untrusted or loosely-typed input into domain types once, at the boundary,
and keep the refined type. Parse database rows and config back into domain types
too — trust nothing inbound, including your own store.

Name parsers `parse_x` (untrusted in), smart constructors `make_x`/`create_x`
(from typed pieces), predicates `is_x`. Avoid `validate_x` for anything that
returns a refined value — it parsed. A schema engine's primitives are pre-tested;
test only the rules *you* add (validators, transforms, cross-field constraints).
See `references/parsing.md` for the pydantic v2 / msgspec / attrs ladder and
smart constructors.

### Make illegal states unrepresentable

Model lifecycle states as tagged unions — a `Union` of frozen dataclasses each
carrying a `Literal` tag — not a bag of `is_x`/`is_y` booleans. Use
`Literal`/`StrEnum` for closed sets. Match exhaustively and put `assert_never` in
the catch-all so a new variant becomes a type error:

```python
def describe(inv: Invoice) -> str:
    match inv:
        case Draft():     return "draft"
        case Sent(sent_at=at): return f"sent {at:%Y-%m-%d}"
        case _:           assert_never(inv)  # new variant -> type error here
```

Avoid boolean behaviour-flag parameters; use named options or domain types.
Booleans are fine as predicate *return* values. (Agnostic version: `architecture`.)
See `references/modeling.md`.

### Value objects and entities

`@dataclass(frozen=True, slots=True)` gives a **value object** value-equality and
immutability for free — the central Python modelling mechanic. An **entity** has
identity, not value-equality: define `__eq__` with an `isinstance` guard over a
stable id, and leave `__hash__` as the default unless `set`/`dict` membership is
actually needed (then base it only on the read-only id). Use `@property` for
derived state and dunder methods (`__gt__`, `__sub__` raising on invalid ops) to
express domain semantics. See `references/modeling.md`.

### Branded primitives — and where the advice stops

`typing.NewType` distinguishes look-alike ids so a raw `str` can't stand in for a
`Sku` or `Reference`. But this is the one place the agnostic advice does *not*
transfer wholesale: brand where mix-ups genuinely bite (id collisions, units);
accept a plain `str`/`int` where a wrapper is pure ceremony. Mindless
primitive-obsession in Python buys complexity, not safety. Record the trade-off
rather than wrapping everything. See `references/parsing.md`.

### Protocol over ABC for ports

A `typing.Protocol` (structural, the narrowest shape a caller needs) is the
default port — the Python analogue of a narrow structural interface. Reach for
`abc.ABC` only when nominal enforcement or shared behaviour earns it. For a
single-method dependency a plain `Callable` is a perfectly good port; reserve a
`Protocol`/ABC for a genuinely multi-method one (read + write). See
`references/ports-persistence.md`.

### Persistence ignorance

Keep domain classes as plain objects with no ORM base class. SQLAlchemy's
imperative (classical) mapping points the database at the model, so your *ORM
imports your model, not the reverse* — the dependency inverts the way the
architecture skill wants. Link aggregates by id (`workspace_id: int`), never by
embedding (`workspace: Workspace`). The signature Python/ORM gotcha the agnostic
skills can't state: `SELECT N+1` from lazy-loaded object graphs — every dotted
attribute can fire a query; reach for eager loading or raw SQL on read paths. See
`references/ports-persistence.md`.

### Dependency injection and bootstrapping

Prefer explicit injection over `mock.patch`-ing imports: a single composition
root (a `bootstrap()` in the entrypoint) wires real adapters, returns the
configured app, and is the one place tests swap in fakes. Compose handlers with
their dependencies via closures or `functools.partial` (mind late binding — a
named `def` beats a `lambda` for stack traces). Keep production defaults in the
bootstrap signature; default a dependency to `None` when constructing the real
one has import-time side effects. Don't reach for a DI framework until
dependencies have their own chained dependencies. (Agnostic config/lifecycle:
`architecture`.) See `references/ports-persistence.md`.

### Resource and transaction boundaries

A `with` block (`__enter__`/`__exit__` or `@contextmanager`) is the syntactic
carrier of a transaction or resource scope — the Unit of Work is `with uow:`.
Design for rollback-by-default: the only path that commits is total success plus
an explicit `commit()`; any exception or early exit rolls back. Own resource
creation and cleanup in the shell; no import-time side effects.

### The Any / cast / type-ignore discipline

The strict basedpyright/ruff config is owned by `mechanical-enforcement`; the
*idioms* here:

- No bare `Any`; use `object` + narrowing (`isinstance`, `TypeGuard`/`TypeIs`).
- `cast()` is a last resort and needs a Rust-style `# SAFETY:` comment.
- Prefer a targeted `# pyright: ignore[reportX]` over a bare `# type: ignore`,
  and keep unused-ignore reporting on so suppressions expire.
- `assert_never` on exhaustive matches; reach for `Self`, `@override`, `@final`.

See `references/conventions.md` for the full discipline, docstrings, and Python
testing specifics.

## References

- `references/errors.md` — Result shape in Python, exception-vs-value boundary,
  domain exceptions, translate-at-the-shell.
- `references/parsing.md` — pydantic v2 / msgspec / attrs ladder, smart
  constructors, branded `NewType` and the overkill verdict.
- `references/modeling.md` — illegal states via `Literal`/`match`/`assert_never`,
  tagged unions via dataclass + `Union`, value objects, the entity
  `__eq__`/`__hash__` contract.
- `references/ports-persistence.md` — Protocol vs ABC, SQLAlchemy imperative
  mapping, `SELECT N+1`/link-by-id, DI/bootstrap/closures, context-manager UoW.
- `references/conventions.md` — `Any`/`cast`/`type-ignore` discipline, docstrings,
  Python testing specifics (fakes not mocks, `pytest.raises(match=)`).
