# Errors and failures

Expected failures are values. Defects throw. Keep the two vocabularies distinct.

## Result shape

Match the repo's existing `result.ts` if it has one. The house default is a
plain tagged union discriminated on `ok` (no library needed):

```ts
// result.ts — explicit success/failure for the pure core. No exceptions below
// the imperative shell — every fallible core function returns a Result.
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

Return it instead of rejecting:

```ts
findActiveByEmail(email: EmailAddress): Promise<Result<ActiveUser, UserLookupError>>
// not: Promise<ActiveUser> that rejects for an ordinary missing user
```

Keep error unions precise at module boundaries
(`Result<User, UserNotFound | UserStoreUnavailable>`). Reserve a broad
`AppError` for entrypoints, orchestration, logging, and rendering only.

**Ladder:** Effect (when the repo uses it — its `E` channel and `Either` *are*
this) > `better-result` (when present) > the local tagged union above.

## Custom tagged errors

Expected failures use custom errors with a stable tag, useful message,
structured context, safe telemetry fields, and an optional `cause`.

```ts
export class UserStoreUnavailable extends Error {
  readonly _tag = "UserStoreUnavailable";
  constructor(
    readonly operation: "findActiveByEmail",
    readonly provider: "postgres",
    readonly cause: unknown,
  ) {
    super(`User store unavailable during ${operation}`);
  }
}
```

Base classes, in order of preference: Effect's `Data.TaggedError` /
`Schema.TaggedError` (Effect repos) > `TaggedError` from `better-result` > plain
`Error` with a `readonly _tag`.

## Panic helpers — the defect vocabulary

Defects throw. These typed helpers return `never`, so they slot into expression
position and still type-check. Keep them as one-liners in `prelude.ts` (the only
sanctioned home for domain-free one-liners — anything mentioning a domain noun
gets its own module).

```ts
// prelude.ts
export function assertNever(x: never): never {        // alias: casesHandled
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
export function shouldNeverHappen(msg?: string): never {
  throw new Error(msg ?? "should never happen");
}
export function notYetImplemented(msg?: string): never {
  throw new Error(`not yet implemented${msg ? `: ${msg}` : ""}`);
}
```

`assertNever` (community-standard name; `casesHandled` is an equally valid alias)
makes a forgotten union branch a compile error:

```ts
switch (shape.kind) {
  case "circle": return Math.PI * shape.radius ** 2;
  case "square": return shape.side ** 2;
  default: return assertNever(shape); // adding a variant breaks this until handled
}
```

Use `@throws` JSDoc only on these defect paths, never on expected typed errors.

## Sensitive values

Wrap tokens, keys, passwords, and credentials in `Redacted<T>` at the boundary;
unwrap only inside the adapter making the external call. Prefer Effect's
`Redacted` in Effect repos, else a local `Redacted<T>` in `prelude.ts`. Never put
secrets in errors, traces, logs, or snapshots. Telemetry carries safe fields
only: domain IDs, operation names, provider names, state tags, retry counts,
typed error tags. (Observability principle: `architecture`.)
