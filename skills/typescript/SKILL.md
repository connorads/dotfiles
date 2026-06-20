---
name: typescript
description: >
  Write idiomatic, type-safe TypeScript: errors as values, parse-don't-validate,
  branded/domain types, deep domain modules, and correct-by-construction APIs.
  Use when designing or reviewing TypeScript specifically — Result types, tagged
  errors, branded types, smart constructors, schema parsing, module/import
  layout, JSDoc, or the cast/`any`/`!` discipline. For language-agnostic design
  use the architecture skill; for lint/tsconfig config use mechanical-enforcement;
  for test strategy use testing.
---

# TypeScript

Concrete TypeScript idioms that make the principles from the `architecture`
skill correct-by-construction. This skill owns the *how* in TypeScript; it does
not restate the agnostic *why* or the enforceable lint config — see routing.

## Routing — who owns what

| Concern | Owner | This skill |
|---|---|---|
| Agnostic principles (functional core/shell, ports, error-as-value concept, observability, workflows/idempotency, config-at-boundary) | `architecture` | states the TS idiom + why, points here |
| Lint rules, strict tsconfig flags, no-`any`/`as`/`!`, no-barrel | `mechanical-enforcement` | names the idiom, points there for config |
| Test strategy, layers, fakes-not-mocks, property tests | `testing` | TS specifics only (fast-check, arbitraries, no `vi.mock`) |
| Coverage thresholds, CI/hook enforcement | `test-coverage` | — |

Rule: state the idiom and *why* it exists here; point out for the agnostic
principle or the enforceable config. Never copy their tables.

## Adapt first

Before applying anything below, read the repo. These are defaults for greenfield
or where the repo has no convention — not a migration mandate.

```text
Does the repo already have a convention for this concern?
|-- errors    -> use its Result/error type or Effect; don't introduce a rival
|-- schema    -> match its parser (zod/valibot/effect Schema); don't add another
|-- modules   -> match its file layout and import style before "fixing" it
|-- tests     -> match its runner and double strategy
`-- none / greenfield -> apply the defaults here; integrate, don't migrate
```

Decision priority when rules pull apart: correctness/safety > existing project
conventions > improving local design > avoid broad migrations > document the
trade-off. New code paths should follow these standards; do not force a
whole-project migration for an unrelated change.

**Effect note.** Effect is the aspirational top of every ladder here: its typed
error channel, `Either`, `Match`, `Redacted`, `Schema`, and layers subsume most
hand-rolled helpers below. Prefer it *once a repo adopts it*. Until then the
hand-rolled defaults apply. Deep Effect patterns are deferred — not yet in this
skill.

## Core idioms

### Errors as values

Expected failures (domain, parsing, auth, I/O, persistence) belong in the return
type, not in a thrown exception. Promise rejection == throwing.

```ts
Promise<Result<User, UserNotFound | UserStoreUnavailable>>  // not Promise<User>
```

Throwing is for unrecoverable *defects* only: violated invariants, impossible
branches, startup misconfiguration, `notYetImplemented`. See `references/errors.md`
for the `Result` shape, tagged-error anatomy, panic helpers, and `Redacted`.

### Parse, don't validate

Turn `unknown` into domain types at the boundary, once, and keep the refined
type. Name parsers `parseX` (untrusted in), smart constructors `makeX`/`createX`
(from typed pieces), predicates `isX`. Avoid `validateX` for anything that
returns a refined value — it parsed. See `references/parsing.md` for schemas and
branded types.

### Make illegal states unrepresentable

Model lifecycle states as tagged unions, not boolean bags. Avoid boolean
behaviour-flags in parameters; use named options or domain types. Booleans are
fine as predicate *return* values. (Agnostic version: `architecture`.)

```ts
type Invoice =
  | { readonly _tag: "Draft"; readonly id: InvoiceId; readonly lines: NonEmptyArray<LineItem> }
  | { readonly _tag: "Sent";  readonly id: InvoiceId; readonly sentAt: Instant };
```

### Deep, cohesive modules

Centre a module on one concept; expose parsers, smart constructors, combinators,
predicates. Depend on the narrowest structural shape a caller needs; let
concrete adapters be wider. Audit existing adapters before creating a new one.
See `references/modules.md` for domain/application modules, the adapter reuse
audit + ADR rule, and import/file layout.

### Exhaustiveness and the cast discipline

Use `assertNever` (alias `casesHandled`) on the `default` branch of a union
switch so a new variant becomes a compile error. Construct branded values only
through parsers — never an `as` cast. Avoid `any` and `!`. Any non-`as const`
cast needs a `// SAFETY:` comment. (Lint that enforces these: `mechanical-enforcement`.)
See `references/conventions.md` for JSDoc and the full cast/`any`/`!` rules.

## References

- `references/errors.md` — Result shape, tagged errors, panic helpers, Redacted
- `references/parsing.md` — parse-don't-validate, schema ladder, branded types + smart constructors
- `references/modules.md` — deep/domain/application modules, narrow-port adapters, reuse-audit + ADR, imports/files, config-at-boundary
- `references/conventions.md` — JSDoc, cast/`any`/`!` discipline, TS testing specifics
