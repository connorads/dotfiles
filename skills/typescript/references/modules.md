# Modules, adapters, and layout

## Deep modules

A deep module hides substantial behaviour behind a cohesive, low-burden interface. Low-burden ≠ few functions - a domain module may expose many cohesive
combinators around one concept and still be deep. Avoid modules that merely
forward calls. Deletion test: if deleting one makes complexity vanish it was
pass-through waste; if it spreads complexity across callers it earned its keep.

## Domain modules

Centre on one concept (one primary type or tight family); expose parsers, smart
constructors, combinators, predicates, formatting, and arbitraries for it. A
namespace import preserves the module shape at the call site:
`import * as EmailAddress from "./email-address"`, then `EmailAddress.parse`. A
class for a domain value constructs through `parse`/`make`, makes invalid
instances unconstructable and carries no hidden I/O (`modeling.md`, "Which
record type").

## Application / service modules

Own real capabilities (`PasswordReset`, `Billing`, `Invitations`). Prefer classes
with constructor injection when there are dependencies, state, or several
cohesive operations. Avoid `deps`-bag objects threaded into every function
(Effect repos: services/tags/layers) and vague names (`Manager`, `Helper`).
Split a module whose methods change for different reasons.

## Narrow structural ports

Depend on the smallest shape a module uses; let the concrete adapter be wider.
Structural typing makes this free, avoiding mega-repositories and
one-method-adapter sprawl alike.

```ts
type UsersForPasswordReset = {
  findActiveByEmail(email: EmailAddress): Promise<Result<ActiveUser, UserLookupError>>;
};
export class PasswordReset {
  readonly #users: UsersForPasswordReset; // not a parameter property: modeling.md
  constructor(users: UsersForPasswordReset) { this.#users = users; }
  start(email: EmailAddress) { return this.#users.findActiveByEmail(email); }
}  // PostgresUsers (findActiveByEmail + findById + updateProfile) satisfies it
```

## Adapter reuse audit

Audit existing adapters before creating one: reuse as-is through a narrow type, then
extend one when the method fits its cohesive capability. A new adapter gets an ADR
recording why neither fitted (not for test fakes); agnostic version: `architecture`.

## Repositories and persistence

Avoid repository-per-table. A repository-like adapter is a cohesive domain
persistence capability returning parsed domain types and typed errors, never raw
rows: parse that infrastructure DTO first, and keep SQL/ORM inside the adapter.

## Batching ports

`await Promise.all(ids.map((id) => members.forOrg(id)))` reads as good concurrent
code and is N queries. Give the port the whole key set, so the round-trip
decision sits in one adapter, not at every call site:

```ts
type Members = {
  forOrgs(ids: readonly OrgId[]): Promise<ReadonlyMap<OrgId, readonly Member[]>>;
};
const byOrg = await members.forOrgs(ids);
return ids.flatMap((id) => (byOrg.get(id) ?? []).map((m) => m.name));
```

`ReadonlyMap` makes the missing-key branch mandatory, and a loader that drops unknown
ids is an N+1 fix that loses rows. Omitting `?? []` is `error TS2532: Object is possibly
'undefined'` under plain `strict`, while `Readonly<Record<OrgId, ...>>` stays clean
unless `noUncheckedIndexedAccess` is set.

The signature confines the decision without enforcing it - `forOrgs` implemented as
`Promise.all(ids.map(queryOne))` typechecks. Review that one adapter, and chunk the
key set inside it: one `IN (...)` over 100k ids exceeds SQLite's 32766 and Postgres'
65535 bind parameters, turning a slow N+1 into a runtime failure. Effect's
`Effect.request` + `RequestResolver` is that shape where a real batch endpoint exists
(vendored `effect` skill).

## Imports, exports, files

- Import directly from the file that owns the abstraction; avoid barrel /
  `index.ts` re-export layers (no-barrel lint: `mechanical-enforcement`).
- Namespace imports for domain modules, named imports for classes and `prelude`
  helpers, `import type` / `export type` for type-only. Export only what callers
  need; don't export internals just for tests.
- Avoid vague files (`utils.ts`, `helpers.ts`, `misc.ts`); use precise names
  (`email-address.ts`). A helper naming a domain noun gets its own module, and
  `prelude.ts` is for tiny domain-free one-liners.

## Import cycles

`tsc` reports nothing on a cycle. Under ESM the failure is a runtime
`ReferenceError: Cannot access 'X' before initialization` - the temporal dead
zone - and it fires on one import order only:

```ts
// cycle-a.ts
import { NAME } from "./cycle-b.ts";
export const TITLE = `title for ${NAME}`; // runs before cycle-b finishes
// cycle-b.ts
import { TITLE } from "./cycle-a.ts";
export const NAME = "order";
export function describe(): string { return TITLE; }
```

`tsc` exits 0 on that pair; `node cycle-b.ts` exits 1 with the ReferenceError
while `node cycle-a.ts` prints the right answer and exits 0 (verified 2026-09-03
against the supported compiler and runtime). Emitted to CommonJS the same source
never throws: `describe()` returns `title for undefined` at exit 0, since a
partly populated `exports` object has no dead zone. A cycle whose modules touch
each other only inside function bodies runs clean too, which is how one survives
months and then breaks on an unrelated import-order change.

A barrel makes the crashing order the public entry. With `export * from
"./order.ts"` ahead of `export * from "./config.ts"` in `index.ts`, importing the
barrel exits 1 while importing `order.ts` directly exits 0 - and an `"exports"`
map naming that barrel sends every consumer the crashing way.

Three fixes: invert the edge with a structural port declared in the consumer;
extract the shared concept into a third module both depend on; merge two modules
that always change together. `import type` also deletes the runtime edge, but
only for a type-only entity, and under `verbatimModuleSyntax` the value form of
that import is `error TS1484`, so the compiler forces the spelling. That fix
takes the report with the crash - oxlint `import/no-cycle` and knip
`--include cycles` both exit 0 on a type-only cycle, while madge exits 1 on it
(verified 2026-09-03 against the versions owned by `mechanical-enforcement`). Detection
is a lint job, not a `tsc` one; wiring: `mechanical-enforcement`.

## Enforceable module boundaries

When a module boundary becomes a standing rule, name it in domain language
first and then encode it mechanically. Good names read like invariants -
`domain-not-to-app-shells`, `pure-access-not-to-runtime`. Direct one-edge bans
belong in `no-restricted-imports` / `no-restricted-syntax`; transitive "must
never reach" rules are architecture tests, tooling: `mechanical-enforcement`.
Allow type-only imports deliberately: if a type is safe to share but the runtime
module is not, say so in the rule and encode it with a tool that tells them apart.

## Configuration and resources

Configuration lifetimes and import-side-effect policy live in
`architecture/references/configuration-lifecycle.md`, Configuration lifecycle.
Resource ownership lives in `resources.md`, The composition root is a scope;
clock mechanics live in `resources.md`, Inject the clock.
