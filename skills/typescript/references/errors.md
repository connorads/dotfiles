# Errors and failures

Expected failures are values. Defects throw. A signature cannot declare what it
throws, so the return type is the only place a caller learns a call can fail.
(Agnostic principle: `architecture`, Error Handling.)

## Result shape

Match the repo's existing `result.ts`. The house default is a plain tagged union on
`ok`, no library, and no exceptions below the shell.

```ts
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

Return it rather than rejecting: `Promise<Result<ActiveUser, UserLookupError>>`,
never a `Promise<ActiveUser>` that rejects for an ordinary missing user. Error
unions stay precise at module boundaries (`Result<User, UserNotFound | UserStoreUnavailable>`);
a broad `AppError` is for entrypoints, orchestration, logging, and rendering.

No linter ships a must-use rule for a data-only tagged union, so a dropped
`Result` is invisible to every gate (`mechanical-enforcement` owns what rules
exist). Where enforcement decides the shape, that absence is the deciding fact.

## The ladder

**Effect,** in a repo that already runs it; adopting it is a separate decision (`SKILL.md`, Adapt
first). Write against v4: the `Result` module is this shape under other names
(`Result.succeed`/`Result.fail`, payloads `.success`/`.failure`), `Effect.result` moves a failure
into it, and `Effect.catch` handles one inside the channel. Verified 2026-09-03: `effect@latest`
is 3.22.1, whose module is `Either` and combinator `Effect.either`, so install v4 explicitly with
`pnpm add effect@rc` (4.0.0-rc.112). Deep Effect patterns: the vendored `effect` skill (`skl effect`).

**`better-result`,** for a `TaggedError` base without Effect. Its subclasses are
`extends <call expression>`, which no declaration emitter can infer - tsc reports
`TS9021: Extends clause can't contain an expression with --isolatedDeclarations` - so a
package publishing types cannot use it; and it is ESM-only, so a CommonJS file under
`module: node16`/`node18` gets `TS1479` (`nodenext`/`bundler` are fine).

**The local tagged union above,** otherwise.

`neverthrow` has the fullest combinator surface but stalled releases, and its must-use
plugin does not run on TS 7. `true-myth` ships the only first-party must-use gate
(`true-myth/eslint-plugin`), but it imports `@typescript-eslint/utils` without declaring
it and typescript-eslint refuses TS 7. Versions: `toolchain.md`, Library facts. Do not
start with `ts-results` (no publish since 2021), `oxide.ts` (abandoned 2022) or `fp-ts`
(maintenance mode).

Crossing the seam out of Effect keeps `E` in the value, not in the throw:

```ts
import { Effect, Result } from "effect"; // v4; ok, err, Res from ./result.ts
export const toEffect = <A, E>(r: Res<A, E>): Effect.Effect<A, E> => (r.ok ? Effect.succeed(r.value) : Effect.fail(r.error));
export const toHouse = <A, E>(e: Effect.Effect<A, E>): Effect.Effect<Res<A, E>> =>
  Effect.map(Effect.result(e), (r) => (Result.isSuccess(r) ? ok(r.success) : err(r.failure)));
```

`Effect.runPromise` is typed `<A, E>(effect: Effect<A, E>) => Promise<A>`, so `E`
is erased from the compiler's view and `catch` binds `unknown`. Handle typed
failures with `Effect.catch` or `Effect.result` before the run call, not after.

## Custom tagged errors

Expected failures carry a stable tag, a useful message, structured context, safe
telemetry fields, and an optional `cause`. Write the fields out: constructor
parameter properties are `error TS1294` under `erasableSyntaxOnly`.

```ts
export class UserStoreUnavailable extends Error {
  readonly _tag = "UserStoreUnavailable";
  readonly operation: "findActiveByEmail";
  constructor(operation: "findActiveByEmail", cause: unknown) {
    super(`User store unavailable during ${operation}`, { cause });
    this.operation = operation;
  }
}
```

That shape is for non-Effect repos. An Effect repo uses `Data.TaggedError("Tag")<{...}>`,
or `Schema.TaggedError` where the error crosses a boundary; both produce real
`Error` instances, so stacks and `cause` survive.

## Panic helpers - the defect vocabulary

Defects throw. Keep these in `prelude.ts`, the home for domain-free one-liners.

```ts
// prelude.ts - each returns `never`, so it fits in expression position.
export function assertNever(x: never): never {  // alias: casesHandled
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
export function shouldNeverHappen(msg = "should never happen"): never { throw new Error(msg); }
export function notYetImplemented(what: string): never { throw new Error(`not yet implemented: ${what}`); }
```

`assertNever` on a `switch` default turns a forgotten union branch into a compile error
(`modeling.md` owns those unions). `@throws` JSDoc goes on defect paths only (`conventions.md`).

## Fail fast, or accumulate

Chain for dependent steps: step two needs step one's value, so there is nothing to
accumulate. Independent validations accumulate in the parser, in one pass, not in a
`Result` chain (`parsing.md`). `AggregateError` is the language's only grouped-failure
type and only `Promise.any` produces one: `Promise.all` rejects with its first error
alone and discards every sibling failure (verified 2026-09-03 on node 24), so a scope
reporting all of them builds it by hand (`concurrency.md`).

## Translation at the shell

Boundaries throw: JSON parsing, ORM integrity errors, HTTP and socket failures. Catch
them at the shell and translate to a domain value or typed error; one reaching the pure
core is control flow the core cannot type. Cancellation arrives as a `DOMException`, an
`Error` subclass, so `instanceof Error` does not discriminate it - the `name` does, and
there are two. `AbortSignal.timeout` aborts with `TimeoutError` and an explicit
`controller.abort()` with `AbortError` (verified 2026-09-03 on node 24), so a helper
testing only `AbortError` reports false for every deadline it sets (`concurrency.md`).

## Sensitive values

Wrap tokens, keys, passwords, and credentials in `Redacted<T>` at the boundary and
unwrap only inside the adapter making the external call. Prefer Effect's `Redacted` in
Effect repos, else a local `Redacted<T>` in `prelude.ts`. Secrets never reach errors,
traces, logs, or snapshots. Telemetry carries safe fields only: domain IDs, operation
and provider names, state tags, retry counts, typed error tags (`architecture`).
