---
name: python
description: >
  Write idiomatic, type-safe Python: errors as values and how to compose them,
  parse-don't-validate with pydantic, frozen kw-only dataclass value objects,
  unions with match and assert_never, Protocol ports, persistence-ignorant
  domain models, package layout and import discipline, config parsed once at a
  composition root that is a scope, structured concurrency, interpreter and
  library version choice, and the Any/cast/type-ignore discipline. Use when
  designing or reviewing Python specifically - Result/typed errors, pydantic
  boundaries, dataclasses, Protocol vs ABC, structural pattern matching, smart
  constructors, DI/bootstrap, module layout, circular imports, asyncio task
  groups, retries, which Python version to target, or basedpyright. For
  language-agnostic design use the architecture skill; for ruff/basedpyright
  config use mechanical-enforcement; for test strategy use testing.
---

# Python

Concrete Python idioms that make the principles from the `architecture` skill
correct-by-construction. This skill owns the *how* in Python; it does not restate
the agnostic *why* or the enforceable lint/type-checker config - see routing.

## Routing - who owns what

| Concern | Owner | This skill |
|---|---|---|
| Agnostic principles (functional core/shell, ports, error-as-value concept, observability, workflows/idempotency, config-at-boundary, the three config lifetimes) | `architecture` (`references/configuration-lifecycle.md` for config) | states the Python idiom + why, points here |
| ruff format/lint, basedpyright `recommended`, no-`Any`, vulture, import-linter / tach contracts, purity bans, pytest strictness | `mechanical-enforcement` (`references/python.md`) | names the idiom, points there for config |
| Test strategy, layers, fakes-not-mocks, property tests | `testing` | Python specifics only (pytest, hypothesis, no `mock.patch`) |
| Coverage thresholds, mutation, CI/hook enforcement | `test-coverage` | - |
| Structured logging | `logging-best-practices` (`references/python.md`) | points there |

Rule: state the idiom and *why* it exists here; point out for the agnostic
principle or the enforceable config. Never copy their tables.

## Adapt first

Before applying anything below, read the repo. These are defaults for greenfield
or where the repo has no convention - not a migration mandate.

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

**Version floor.** Every snippet here is Python 3.12+ (PEP 695 generics and
`type` aliases); 3.14 is the default for new work. `references/toolchain.md`
owns the floor, the idiom-to-version table, and every dated library fact - no
other page carries a version number. Much of the Cosmic-Python canon (raw
dataclasses, exception-first flow) predates pydantic v2, `match` and
basedpyright - prefer the modern idiom in new code.

## Core idioms

### Errors as values

Python defaults to exceptions, but expected failures (domain, parsing, auth,
persistence) belong in the return type, not a raised exception.

```python
def find_active(email: EmailAddress) -> Result[ActiveUser, UserLookupError]: ...
# not: -> ActiveUser that raises for an ordinary missing user
```

Which `Result` is a type-checker decision. Under a basedpyright gate the house
default is the hand-rolled frozen `Ok | Err` union consumed with `match`;
`returns` earns its place only in mypy repos, because the inference behind its
railway combinators is a mypy plugin that pyright cannot see. Raising is for
*defects* only: violated invariants, impossible branches, startup
misconfiguration, `raise NotImplementedError`.

Exceptions are unavoidable at boundaries (`StopIteration`, `KeyError`, ORM
integrity errors). Catch and *translate* them into domain values or errors at
the shell, never deep in the core. See `references/errors.md`.

### Composing fallible steps

Three forms, picked by intent. Chain with `map_ok`/`and_then` when each step
needs only its predecessor's output. Switch to an early-return ladder the moment
a later step needs more than its predecessor - Python has no `?` and no
do-block, so nested closures read worse than the ladder. Inside one module,
raise a module-private error and translate once at the public seam, so a
six-step interior stays readable while the public function stays total. Map
every step's error into one channel before composing, and collapse an iterable
of results with `traverse`, never a hand-rolled accumulator that yields a
partial success. Fail fast for dependent steps; for independent validations
pydantic's `ValidationError.errors()` already accumulates. See
`references/errors.md`.

### Make signatures total and honest

Two moves make a partial function total: constrain the input (a parsed or
`NewType` value) or widen the output (`Result`). Prefer constraining, which
deletes the branch for every caller. `None` is not an error channel: `-> User |
None` cannot say whether the user was absent or the store was down, and Python
makes it worse because `None` is also a legal stored value. `-> None` from core
logic hides a mutation; return the new value or the events. A parameter that
defaults to `None` is a partial function wearing a total signature - split the
operation. Python has no checked exceptions, so the return type is the only
place a caller learns about failure.

### Parse, don't validate

Turn untrusted or loosely-typed input into domain types once, at the boundary,
and keep the refined type. Parse database rows and config back into domain types
too - trust nothing inbound, including your own store.

Name parsers `parse_x` (untrusted in), smart constructors `make_x`/`create_x`
(from typed pieces), predicates `is_x`. Avoid `validate_x` for anything that
returns a refined value - it parsed. Pydantic models at the boundary carry
`model_config = ConfigDict(strict=True, extra="forbid")`: the correct-by-
construction control no linter can substitute for. A schema engine's primitives
are pre-tested; test only the rules *you* add. See `references/parsing.md`.

### Make illegal states unrepresentable

Model a lifecycle as a union of frozen dataclasses, not a bag of `is_x`/`is_y`
booleans. Class patterns plus `assert_never` exhaust the union with no tag
field at all; a `Literal` tag earns its place only where the union is
serialised (pydantic discriminator, msgspec tag). Use `Literal`/`StrEnum` for
closed sets.

```python
match inv:
    case Draft():          ...
    case Sent(sent_at=at): ...
    case _:                assert_never(inv)  # new variant -> type error
```

Avoid boolean behaviour-flag parameters; use named options or domain types.
Booleans are fine as predicate *return* values. (Agnostic version: `architecture`.)
See `references/modeling.md`.

### Value objects and entities

`@dataclass(frozen=True, slots=True, kw_only=True)` is the house value object:
value-equality, hashability, no positional swaps. Know what it does not buy.
`frozen` blocks rebinding, not mutation of what a field points at - a `list`
field mutates and makes the instance unhashable, so hold `tuple`/`frozenset`.
`slots` breaks `functools.cached_property` at first access, so derived state is
`@property`. Keyword-only fields leave `__match_args__` empty, so match on
keyword patterns. An **entity** has identity: `@dataclass(eq=False)` plus a
hand-written `__eq__` over the stable id, `__hash__` only when membership is
needed. See `references/modeling.md`.

### Branded primitives - and where the advice stops

`typing.NewType` brands statically only: every parser erases it, so
`TypeAdapter(UserId).validate_python("42")` returns a plain `int` and runs none
of your rules. Use `NewType` for an id whose only rule is "do not mix these
up"; use an `Annotated` alias (`type Slug = Annotated[str, BeforeValidator(...),
StringConstraints(...)]`) when the type carries a rule the boundary must apply.
Accept a plain `str`/`int` where a wrapper is pure ceremony. See
`references/parsing.md`.

### Deep modules and a public surface

One package per bounded context under `src/`; `__init__.py` is the package's
public interface and the only importable surface, marked by `__all__` or an
`X as X` re-export so the checker can police it. Absolute imports throughout.
No `utils.py`/`models.py`/`services.py`. A fat `__init__.py` is worse than a
TypeScript barrel because importing the package *executes* every submodule it
re-exports. No import-time side effects: a module-level `CLIENT =
httpx.Client(...)` looks like a constant and is I/O plus a hard startup
dependency. `TYPE_CHECKING` removes the runtime import, not the coupling. Break
a cycle by inverting to a consumer-side `Protocol`, extracting a third module,
or merging - never with a function-local import. See `references/modules.md`.

### Protocol over ABC for ports

A `typing.Protocol` (structural, the narrowest shape a caller needs) is the
default port. Reach for `abc.ABC` only when nominal enforcement or shared
behaviour earns it. For a single-method dependency a plain `Callable` is a
perfectly good port; reserve a `Protocol`/ABC for a genuinely multi-method one
(read + write). See `references/ports-persistence.md`.

### Persistence ignorance

Keep domain classes as plain objects with no ORM base class. SQLAlchemy's
imperative (classical) mapping points the database at the model, so your *ORM
imports your model, not the reverse*. Link aggregates by id (`workspace_id:
int`), never by embedding. The signature Python/ORM gotcha: `SELECT N+1` from
lazy-loaded object graphs - every dotted attribute can fire a query; reach for
eager loading or raw SQL on read paths. See `references/ports-persistence.md`.

### Configuration and a composition root that is a scope

Parse config once at the composition root into a frozen typed value
(`pydantic-settings`, `SecretStr` for credentials, domain types not `str`) and
refuse to start on bad config. Nothing outside `bootstrap()` touches
`os.environ`. Make the root an `@asynccontextmanager` over an `AsyncExitStack`:
acquisition order is code order, release is its exact reverse on success and
failure alike, and it is the one place tests swap in fakes. Never put a real
adapter in a default argument (`uow=SqlAlchemyUnitOfWork()`) - defaults are
evaluated at import and shared by every call. Retries live in the adapter as a
named policy on a named transient exception, never as an inline loop. Inject
the clock: the core takes `now` as an argument. See
`references/ports-persistence.md`.

### Resource and transaction boundaries

A `with` block (`__enter__`/`__exit__` or `@contextmanager`) is the syntactic
carrier of a transaction or resource scope - the Unit of Work is `with uow:`.
Design for rollback-by-default: the only path that commits is total success plus
an explicit `commit()`; any exception or early exit rolls back.

### Structured concurrency

Every task has an owner: spawn only inside `asyncio.TaskGroup` (or an anyio
task group), because a bare `create_task` is weakly referenced and can be
collected before it runs. A failed child arrives wrapped in an `ExceptionGroup`
even when it is the only failure, so a plain `except OutOfStock:` stops
matching the moment code moves inside a group - unwrap once at the shell, then
translate. Never swallow `CancelledError`. Nothing blocks the loop:
`asyncio.to_thread` for sync I/O, a process pool for CPU. `AsyncIterator[T]`
is the port type for a stream, not `list[T]`. See `references/concurrency.md`.

### The Any / cast / type-ignore discipline

The basedpyright/ruff config is owned by `mechanical-enforcement`; the *idioms*
here:

- No bare `Any`; use `object` + narrowing (`isinstance`, `TypeIs`; `TypeGuard`
  only when the narrowed type is not a subtype of the input).
- `cast()` is a last resort and needs a Rust-style `# SAFETY:` comment.
- Prefer a targeted `# pyright: ignore[reportX]` over a bare `# type: ignore`,
  and keep unused-ignore reporting on so suppressions expire.
- `assert_never` on exhaustive matches; reach for `Self`, `@override`, `@final`,
  and `@warnings.deprecated` carrying the replacement and the deletion condition.
- Parameters take `Sequence`/`Mapping`/`Iterable`; returns state the concrete type.

See `references/conventions.md`.

## References

- `references/errors.md` - the `Result` shape, the type-checker-decision ladder,
  composing fallible steps (chain, ladder, seam, one error channel, traverse),
  translate-at-the-shell, what a docstring's failure note may say.
- `references/parsing.md` - pydantic v2 / msgspec / attrs ladder, `strict` +
  `extra="forbid"`, smart constructors, `NewType` vs `Annotated` carriers,
  injection-shaped APIs.
- `references/modeling.md` - the record-type chooser, illegal states via
  `match`/`assert_never`, the house dataclass and what it costs, value objects,
  the entity `__eq__`/`__hash__` contract.
- `references/modules.md` - deep modules, package layout, the public surface,
  no import-time side effects, `TYPE_CHECKING` cost, breaking cycles,
  enforceable boundaries.
- `references/ports-persistence.md` - Protocol vs ABC, SQLAlchemy imperative
  mapping, `SELECT N+1`, config at the boundary, the `AsyncExitStack`
  composition root, UoW, retries in the adapter, injecting the clock.
- `references/concurrency.md` - task ownership, exception groups, cancellation,
  never blocking the loop, streams and back-pressure.
- `references/toolchain.md` - version floor and default, idiom-to-version table,
  deferred annotations on 3.14, uv, free-threading, dated library facts.
- `references/conventions.md` - `Any`/`cast`/`type-ignore` discipline, `TypeIs`
  narrowing, collection types in signatures, `@warnings.deprecated`, docstrings,
  Python testing specifics (fakes not mocks, `pytest.raises(match=)`,
  `RaisesGroup`).
