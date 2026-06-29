# Conventions: types, docstrings, testing

## The Any / cast / type-ignore discipline

The strict basedpyright/pyright settings and ruff rules are owned by
`mechanical-enforcement` — that is where the config lives. The *idioms* this skill
cares about:

- No bare `Any`. Use `object` plus narrowing (`isinstance`, `TypeGuard`/`TypeIs`),
  a `Protocol` for the shape you need, or a precise union.
- `cast()` is a last resort for interop the type system can't express, and needs a
  Rust-style safety comment:

```python
# SAFETY: pydantic validated the discriminator above; this branch is the Sent
# variant, which the checker cannot narrow across the boundary.
return cast(Sent, parsed)
```

- Prefer a targeted `# pyright: ignore[reportReturnType]` over a bare
  `# type: ignore`, and keep `reportUnnecessaryTypeIgnoreComment` on so a
  suppression that stops being needed becomes an error.
- `assert_never` on exhaustive matches (see `modeling.md`). Reach for `Self`,
  `@override`, `@final`, `Annotated`, and PEP 695 generics (`def f[T](...)`).
- Prefer immutable values (`frozen=True`, `tuple` over `list` in domain types);
  mutation is fine inside localised shell code and builders.

## Docstrings

Document invariants, trade-offs, non-obvious rules, and safety justifications —
not what the signature already says. A one-line docstring on a domain class or
public function that states *why* it exists earns its place; a restated parameter
list does not.

```python
def allocate(line: OrderLine, batches: list[Batch]) -> Reference:
    """Allocate a line to the earliest-available batch.

    Raises OutOfStock when no batch can satisfy the line — a domain outcome the
    shell maps to HTTP 400, not a defect.
    """
```

## Python testing specifics

Strategy, layers, and fakes-not-mocks are owned by `testing`; coverage and
mutation by `test-coverage`. Python-specific points:

- **Don't `mock.patch` what you own.** Inject a fake through the composition root
  instead (`ports-persistence.md`). Patching imports couples the test to the
  import form and survives mutation of the real collaborator.
- Use simple fakes for owned ports: `FakeRepository(set)`, a `FakeUnitOfWork`
  exposing a `committed` flag. Assert observable behaviour — returned value/error,
  persisted state, an event recorded in a fake — not that a method was called.
- `pytest.raises(DomainError, match="...")` for the failure path; one happy-path
  assertion per behaviour.
- **hypothesis** for parsers, smart constructors, round-trips, normalisation, and
  state machines (framework details in `testing`'s property-based-testing
  reference).
- Build fixtures through parsers and smart constructors; tests must not bypass an
  invariant to construct a fixture. Counter-based factory helpers keep ids unique
  in stateful integration tests.
