---
name: typescript
description: >
  Write idiomatic, type-safe TypeScript: errors as values and composing them,
  parse-don't-validate, branded and domain types, the record-type choice
  (interface, type, class, brand, readonly, as const satisfies), deep domain
  modules and import cycles, cancellation with AbortSignal and structured
  concurrency, resource and transaction scopes with using and
  AsyncDisposableStack, the composition root, retries and the injected clock,
  exhaustiveness and the cast/`any`/`!` discipline, the Effect adoption
  boundary, and which compiler and runtime to target (TS 7, Node, Bun, Deno,
  erasable syntax). Use when designing or reviewing TypeScript specifically.
  Routing: architecture for agnostic design, mechanical-enforcement for lint
  and tsconfig config, testing for test strategy, the vendored effect skill
  for programs written in Effect.
---

# TypeScript

Concrete TypeScript idioms that make the `architecture` skill's principles
correct-by-construction: the *how*, not the agnostic *why* or the enforceable
config - see routing.

## Routing - who owns what

| Concern | Owner | This skill |
|---|---|---|
| Agnostic principles (functional core/shell, ports, errors as values, observability, config lifetimes) | `architecture` | states the TS idiom + why, points there |
| tsconfig flags, lint rules, boundaries, purity bans, test and publish gates | `mechanical-enforcement` (`references/typescript.md`) | names the idiom, points there for config |
| Inside an Effect program: `Effect.gen`, services, layers, `Schema`, `Schedule`, `Stream` | vendored `effect` skill (`skl effect`) | the adopt/decline boundary and the seam only |
| Test strategy, layers, fakes-not-mocks, property tests | `testing` | TS specifics only (fast-check, no `vi.mock`) |
| Coverage, mutation, CI/hook enforcement | `test-coverage` | - |

Rule: state the idiom and its *why* here, point out for the rest, and never copy
their tables.

## Adapt first

Read the repo first. These are defaults for greenfield or where the repo has no
convention - not a migration mandate.

```text
Does the repo already have a convention for this concern?
|-- errors      -> its Result type or Effect; no rival
|-- schema      -> its parser (effect Schema / zod / valibot); no second one
|-- modules     -> its file layout and import style before "fixing" it
|-- concurrency -> its cancellation convention (signal parameter or none) before adding one
|-- tests       -> its runner and double strategy
`-- none        -> the defaults here; integrate, don't migrate
```

Priority when rules pull apart: correctness/safety > existing conventions >
better local design > avoiding broad migrations > documenting the trade-off. A
new code path follows these standards; an unrelated change migrates nothing.

**Effect boundary.** Use Effect when the repo already depends on it. In another
repo, typed errors, dependency injection, retry policy and structured concurrency
together justify proposing adoption for discussion, never introducing it silently;
one or two alone is a `Result` plus the idioms below.
Discuss the target version, then read the `effect` skill for everything inside an
Effect program. This skill owns the seam only: see `references/errors.md`.

**Runtime floor.** The compiler is not the runtime: Node strips types and checks
nothing, so only erasable syntax runs, and a global the `lib` types (Temporal,
`DisposableStack`) may not exist where the code runs. `references/toolchain.md`
owns the floor (Node 24), the capability facts, and every dated library fact -
no other page carries a version number.

## Core idioms

### Errors as values

Expected failures - domain, parsing, auth, I/O, persistence - belong in the
return type, not a thrown exception, and a rejected promise is a throw.

```ts
Promise<Result<User, UserNotFound | UserStoreUnavailable>>  // not Promise<User>
```

Throwing is for defects only; a boundary exception translates at the shell.
See `references/errors.md`.

### Composing fallible steps

Chain with `map` and `flatMap` so the first error short-circuits, map every
step's error into one declared channel, and collapse a `Result[]` with `all`,
never a hand-rolled loop. Fail fast for dependent steps; accumulate for
independent validations. See `references/errors.md`.

### Make signatures total and honest

Constrain the input to a parsed or branded value, or widen the output to
`Result`; constraining is better, deleting the branch for every caller. A
`void` return from core logic hides a mutation. See `references/parsing.md`.

### Parse, don't validate

Turn `unknown` into domain types once at the boundary and keep the refined
type. Name parsers `parseX`, smart constructors `makeX`, and predicates
`isX(value): value is X` - a boolean narrows nothing. See
`references/parsing.md`.

### Make illegal states unrepresentable

A lifecycle is a tagged union, not a bag of booleans, and `assertNever` on the
default arm turns a new variant into a compile error. Named options replace
boolean behaviour flags. See `references/modeling.md`.

### Records, entities, and collections

`interface` for object shapes, `type` for unions and mapped types; a class only
for nominality through a `#private` field; brands for primitives; `readonly` is
compile-only and `Object.freeze` is its shallow runtime half. JS objects have no
structural value equality, so entities compare and key by branded id.
See `references/modeling.md`.

### Deep, cohesive modules

Centre a module on one concept and depend on the narrowest structural shape a
caller needs, often a single function type. tsc never reports an import cycle;
the failure is a runtime `ReferenceError` on one import order, which is why the
barrel rule exists. See `references/modules.md`.

### The composition root is a scope

`await using stack = new AsyncDisposableStack()` releases in exact reverse of
acquisition, and ownership leaves the root only through an eager `stack.move()`.
See `references/resources.md`; config lifetime belongs to `architecture`.

### Transaction boundaries

A transaction is a Result-aware closure that commits only an `ok`; an `err`
rolls back, while infrastructure failures receive stable tags. See
`references/resources.md`.

### Cancellation and task ownership

A deadline is unenforceable unless the port type takes `signal: AbortSignal`.
`Promise.all` rejects on the first failure and leaves siblings running with
their later rejections swallowed - it is not a task group; a scope that spawns
must also abort and await. See `references/concurrency.md`.

### Bounded fan-out and back-pressure

`Promise.all(items.map(fn))` sets concurrency to the input size; bound it with a
worker pool whose limit is a checked finite number. A port that streams returns
`AsyncIterable<T>`, and `await` inside `for await` is the back-pressure. See
`references/concurrency.md`.

### Exhaustiveness and the cast discipline

Construct branded values only through parsers, never an `as` cast; avoid `any`
and `!`; `satisfies T` checks a literal without widening it, and `as const
satisfies T` keeps its keys as a literal union. Any other cast carries a
`// SAFETY:` comment, and `@ts-expect-error` with a reason is the only
suppression that expires. See `references/conventions.md`.

## References

- `references/errors.md` - `Result`, the ladder and the Effect seam, tagged errors, panics, `Redacted`.
- `references/parsing.md` - schema ladder, narrowing predicates, brands, optionality.
- `references/modeling.md` - record-type chooser, illegal states, entities, collections.
- `references/modules.md` - deep modules, ports, layout, import cycles, batching port.
- `references/resources.md` - `using`, composition root, transactions, retries, clock.
- `references/concurrency.md` - cancellation, combinators, task ownership, fan-out, back-pressure.
- `references/conventions.md` - casts, suppressions, `satisfies`, `NoInfer`, JSDoc, testing.
- `references/toolchain.md` - TS 7, lib ceiling, erasable syntax, runtimes, dated facts.
