# Conventions: types, docstrings, testing

## The Any / cast / type-ignore discipline

`mechanical-enforcement` owns the basedpyright and ruff config. The idioms:

- No bare `Any`. Use `object` plus narrowing, a `Protocol`, or a precise union; `Any`
  disables checking both ways, laundering a wrong type through every caller.
- `cast()` is a last resort for interop the type system cannot express, and carries a
  Rust-style `# SAFETY:` comment naming the invariant that makes it sound.
- Prefer `# pyright: ignore[reportReturnType]` over a bare `# pyright: ignore`: the
  rule-coded form expires once the error goes (`reportUnnecessaryTypeIgnoreComment`
  flags it), while a bare one absorbs the next unrelated error on that line and only
  `reportIgnoreCommentWithoutRule` says so.
- `# type: ignore` is inert under `recommended` (`enableTypeIgnoreComments=false`): it
  suppresses nothing and reports nothing, so a suppression inherited from a mypy
  codebase is dead text with every error behind it live.
- `assert_never` on exhaustive matches (`modeling.md`). Reach for `Self`, `@override`,
  `@final`, `Annotated`, and PEP 695 generics (`def f[T](...)`).
- Prefer immutable values (`frozen=True`, `tuple` over `list` in domain types); mutation
  is fine inside localised shell code and builders.

Those two suppression rules and `reportDeprecated` carry **warning** severity under
`recommended`, blocking only because it also sets `failOnWarnings` - a hook wired
`--level error`, or CI reading the JSON `errorCount`, exits 0 with them live, so
`mechanical-enforcement` pins each at `"error"`.

## Narrowing predicates: `TypeIs` by default

Annotate an `is_x` predicate with `typing.TypeIs` (PEP 742, stdlib since 3.13), as in
`def is_active(u: User) -> TypeIs[ActiveUser]`: it narrows the negative branch as well
as the positive, what the predicate actually claims. With `TypeGuard` the `else` stays
at the declared `ActiveUser | SuspendedUser`, so the caller writes a redundant second
check or reaches for the `cast()` this page rations. `TypeGuard` earns its place only
where the narrowed type is not a subtype of the parameter type, which `TypeIs` forbids:
`TypeIs[list[str]]` on a `list[object]` parameter is a `reportGeneralTypeIssues` error,
so that predicate takes `TypeGuard[list[str]]`. Naming (`parse_x` / `make_x` / `is_x`)
is in `parsing.md`.

## Collection types in signatures

Parameters take the abstract type (`Sequence`, `Mapping`, `Iterable`,
`collections.abc.Set` - `typing.AbstractSet` is a deprecated alias `reportDeprecated`
flags); returns state the concrete one, so the caller knows whether it is re-iterable:
`tuple[X, ...]` for a domain value it should not mutate, `list[X]` for one it owns.

- `list` is invariant: `list[Manager]` is rejected where `list[Employee]` is declared,
  `Sequence[Manager]` accepted - the commonest spurious checker error, and the thing an
  agent most often "fixes" with a `cast()`.
- `Sequence` has no `append`, so the annotation is a checker-enforced promise the callee
  does not mutate the caller's list.
- Take `Iterable` only where a single pass is genuinely all the function does. An
  `Iterable` iterated twice is a silent wrong answer on a generator, not an error:
  `sum(xs)` then `len(list(xs))` returns the right total and a length of 0.

## Deprecation carries its deletion condition

`@warnings.deprecated` (PEP 702, stdlib since 3.13) is seen twice: basedpyright flags
every call site (`reportDeprecated`), the runtime emits a `DeprecationWarning`. Put the
replacement *and* the named deletion condition in the message, so the marker carries the
expand-migrate-contract contract, not a comment nobody greps:

```python
@warnings.deprecated(
    "Use parse_email; delete when the last v1 client retires (target 2026-12)."
)
def validate_email(raw: str) -> str: ...
```

A deprecation with no deletion condition is a permanent second code path; migration
mechanics are the `refactoring` skill's.

## Docstrings

Document *why*: invariants, trade-offs, non-obvious rules, safety justifications; a
restated parameter list earns no place. A `Result[T, E]` return names its failures in
`E`, and `errors.md` says what a `Raises:` note documents.

```python
def allocate(
    line: OrderLine, batches: Sequence[Batch]
) -> Result[Reference, OutOfStock]:
    """Allocate to the earliest-arriving batch that can take the line.

    Ordering is the domain rule: in-stock batches (no ETA) outrank shipments, and
    an allocated batch is never re-sorted, so repeat calls are stable.
    """
```

## Python testing specifics

Strategy, layers and fakes-not-mocks belong to `testing`, coverage and mutation to
`test-coverage`, the lint config below to `mechanical-enforcement`. Python-specific:

- **Do not `mock.patch` what you own.** Inject a fake through the composition root
  (`ports-persistence.md`): patching imports couples the test to the import form and
  survives mutation of the collaborator. `mechanical-enforcement` bans `unittest.mock`
  imports and pytest-mock's `mocker` fixture in test trees.
- Use simple fakes for owned ports: `FakeRepository(set)`, a `FakeUnitOfWork` exposing a
  `committed` flag. Assert observable behaviour - returned value or error, persisted
  state, an event recorded in a fake - not that a method was called.
- `pytest.raises(DomainError, match="...")` for the failure path; one happy-path
  assertion per behaviour. Without `match=` it passes on any instance of the type,
  including one raised elsewhere. ruff PT011 gates it once configured with the project's
  error classes.
- A child failing inside a task group arrives wrapped in an `ExceptionGroup` **even when
  there is exactly one**, so `pytest.raises(OutOfStock)` fails against it. Below the
  shell's unwrap seam assert with `pytest.RaisesGroup` (pytest 8.4+, with
  `pytest.RaisesExc`); above it, plain `pytest.raises` on the translated domain error,
  which fails the day someone drops the unwrap (`concurrency.md`).

  ```python
  with pytest.RaisesGroup(pytest.RaisesExc(OutOfStock, match="sku-1")):
      await place_order(cmd)
  ```

- **hypothesis** for parsers, smart constructors, round-trips, normalisation and state
  machines (framework details in `testing`'s property-based-testing reference).
- Build fixtures through parsers and smart constructors; never bypass an invariant to
  construct one. Counter-based factory helpers keep ids unique in stateful tests.
