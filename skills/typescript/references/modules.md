# Modules, adapters, and layout

## Deep modules

A deep module hides substantial behaviour behind a cohesive, low-burden
interface. Low-burden ≠ few functions — a domain module may expose many cohesive
combinators around one concept and still be deep. Avoid shallow modules that
merely forward calls or mirror tables.

Deletion test: if deleting the module makes complexity vanish, it was
pass-through waste; if it spreads complexity across callers, it earned its keep.

## Domain modules

Centre on one concept (one primary type or tight family); expose parsers, smart
constructors, combinators, predicates, formatting, and arbitraries for it.
Namespace imports preserve the module shape:

```ts
import * as EmailAddress from "./email-address";
EmailAddress.parse(input);
```

If using a class for a domain value: construct through `parse`/`make`, make
invalid instances unconstructable, keep fields readonly, no hidden I/O, no
inheritance for behaviour.

## Application / service modules

Own real capabilities (`PasswordReset`, `Billing`, `Invitations`). Prefer
classes with constructor injection when there are dependencies, state, or
several cohesive operations. Avoid `deps`-bag objects threaded into every
function (Effect repos: services/tags/layers instead). Avoid vague names
(`Manager`, `Processor`, `Helper`). Split a module when its methods change for
different reasons or need unrelated dependencies.

## Narrow structural ports

Depend on the smallest shape a module uses; let the concrete adapter be wider.
Structural typing makes this free and avoids both mega-repositories and
one-method-adapter sprawl.

```ts
type UsersForPasswordReset = {
  findActiveByEmail(email: EmailAddress): Promise<Result<ActiveUser, UserLookupError>>;
};
export class PasswordReset {
  constructor(private readonly users: UsersForPasswordReset) {}
}
// PostgresUsers (findActiveByEmail + findById + updateProfile) satisfies it.
```

## Adapter reuse audit

Before creating a new adapter/service, audit existing ones. Prefer, in order:
reuse as-is through a narrow type → extend an existing adapter when the method
fits its cohesive capability → only then create a new one. When you do create a
meaningful new adapter, write an ADR recording what you checked and why reuse and
extension did not fit. (No ADR for trivial in-memory test fakes or framework
glue.) The agnostic version of this discipline lives in `architecture`.

## Repositories and persistence

Avoid repository-per-table. A repository-like adapter is fine when it is a
cohesive domain persistence capability returning parsed domain types and typed
errors — not raw rows and ORM errors. Treat rows/ORM models as infrastructure
DTOs; parse them before core logic. Keep SQL/ORM inside the adapter.

## Imports, exports, files

- Import directly from the file that owns the abstraction; avoid barrel /
  `index.ts` re-export layers (no-barrel lint: `mechanical-enforcement`).
- Namespace imports for domain modules; named imports for classes and `prelude`
  helpers. Use `import type` / `export type` for type-only.
- Export only what callers need; don't export internals just for tests.
- Avoid vague files (`utils.ts`, `helpers.ts`, `common.ts`, `misc.ts`). Use
  precise names (`email-address.ts`, `billing-period.ts`, `result.ts`). A helper
  that mentions a domain noun gets its own module; `prelude.ts` is only for tiny
  ubiquitous domain-free one-liners.

## Enforceable module boundaries

When a module boundary becomes a standing rule, name it in domain language first
and then encode it mechanically. Direct one-edge bans belong in
`no-restricted-imports` / `no-restricted-syntax`; transitive "must never reach"
rules are architecture tests, with TypeScript graph tooling configured through
the `mechanical-enforcement` skill.

Good boundary names read like invariants:

- `domain-not-to-app-shells`
- `pure-access-not-to-runtime`
- `ui-not-to-server-modules`
- `private-content-through-approved-boundaries`

Allow type-only imports deliberately, not accidentally. If a type is safe to
share but the runtime module is not, say that in the rule and encode it with the
tool that can distinguish type-only imports.

## Configuration and resources

Parse env/config at startup into typed config with branded/`Redacted` values.
Do not read `process.env` throughout the app; missing/invalid config is a startup
failure with useful context. No top-level side effects outside true
entrypoint/bootstrap files — modules should not open connections, read env, or
start servers at import time. Inject `Clock`/`Random` into dependency-bearing
modules; pure functions take explicit `now`/random values. (Agnostic version:
`architecture`.)
