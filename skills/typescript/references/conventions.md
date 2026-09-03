# Conventions: types, JSDoc, testing

Diagnostics are verified 2026-09-03 against the compiler in `toolchain.md` under the house strict flags; those flags and the lint rules below belong to `mechanical-enforcement` and are named here as the cause of a diagnostic, never configured.

## Cast / `any` / `!` discipline

- No `any`; use `unknown` plus narrowing (`parsing.md`, "Narrowing predicates").
  A rare `any` in a generic helper needs a targeted lint-ignore plus a reason.
- No `!` non-null assertion; branch, parse, or refine instead.
- No `as Type` casts; `as const` is fine. A cast is a last resort for brand
  internals or interop the type system cannot express, under a SAFETY comment:

```ts
// SAFETY: TypeScript cannot express the brand. parse checked the normalised
// string before branding. Callers cannot construct EmailAddress except here.
return normalised as EmailAddress;
```

- Prefer `satisfies T` (below) for the record cases that tempt an `as T`.
- Prefer immutable values (`readonly`, `readonly T[]`); mutation is fine inside
  localised shell code, builders, or perf-sensitive internals behind a precise
  interface. What `readonly` buys: `modeling.md`, "Collections in signatures".

## `satisfies` keeps the keys literal

`satisfies T` checks a value against `T` without widening it, so no cast happens
and no SAFETY note is needed. The load-bearing consequence is key preservation:

```ts
type Routes = Record<string, { readonly method: "GET" | "POST"; readonly path: string }>;
const routes = {
  list: { method: "GET", path: "/orders" },
  create: { method: "POST", path: "/orders" },
} as const satisfies Routes;
export type RouteName = keyof typeof routes; // "list" | "create"
```

Annotating instead (`const routes: Routes = { … }`) collapses `keyof typeof
routes` to `string`, so `const name: RouteName = "nope"` then compiles clean and
the type that exists to enumerate the routes enumerates nothing.

`as T` is a different check - comparability, not assignability - so it waves a
widened value through: with `declare const m: string`,
`{ list: { method: m, path: "/orders" } } as Routes` compiles, while the same
literal under `satisfies Routes` is `TS2322: Type 'string' is not assignable to
type '"GET" | "POST"'`. The order fails closed: `satisfies T as const` is
`TS1355`, a const assertion applying only to literals. What the target does to
nested `readonly`: `modeling.md`, "Which record type".

## `NoInfer<T>`: checked, not inferred

`NoInfer<T>` marks a parameter that is checked against `T` instead of
contributing to inferring it, keeping a fallback inside the set the other
arguments established. It is a `lib.es5.d.ts` intrinsic, so it needs no opt-in.

```ts
declare function light<C extends string>(colors: C[], fallback: NoInfer<C>): void;
light(["red", "green"], "blue");
// TS2345: Argument of type '"blue"' is not assignable to parameter of type '"green" | "red"'.
```

Three shapes make it gate nothing, each compiling clean with no diagnostic - so
any adoption ships a negative control, a call that must not compile under a
`@ts-expect-error`:

- **One inference site.** `<T extends string>(x: NoInfer<T>)` leaves nothing to
  infer `T` from, so `T` falls back to its constraint and every string passes.
- **A source bound to a variable.** `const cs = ["red", "green"]; light(cs, "x")`
  infers `C` as `string`, so `NoInfer<C>` is `NoInfer<string>`; `as const` on the
  source restores it, and an inline-literal call site hides the difference.
- **A shadow.** A local `type NoInfer<T> = T` overrides the intrinsic silently,
  while a misspelling fails closed (`TS2552: Cannot find name 'NoInfr'`), so
  "does it error at all" does not tell the two apart.

## `const` type parameters

A `const` type parameter preserves literal types from an inline argument, so the
caller writes `pick(["a", "b"])` rather than `pick(["a", "b"] as const)`. Two
caveats decide whether it does anything, both visible in the inferred type only:

| Signature | What `f(["a", "b"])` infers |
|---|---|
| `<T extends readonly string[]>` | `string[]` |
| `<const T extends readonly string[]>` | `readonly ["a", "b"]` |
| `<const T extends string[]>` | `["a", "b"]` |
| `<const T extends readonly string[]>`, argument via a variable | `string[]` |

A mutable constraint keeps the literals and drops the `readonly`, so the tuple
reaches a parser mutable; constrain with `readonly string[]` where immutability
is the point. An argument bound to a variable first is back to `string[]`, since
the modifier acts on the call-site expression. Read the inferred type with `tsc
--declaration --emitDeclarationOnly`; an annotated assignment contextually types
the call and hides the difference.

## Suppression discipline

`// @ts-expect-error` is the only suppression that expires: once the line below
it compiles, `TS2578: Unused '@ts-expect-error' directive` fails the build. Two
limits travel with it.

- **It never checks which error.** A directive over `takesNum("x", notDeclared)`
  keeps TS2578 silent while hiding an unrelated `TS2304: Cannot find name
  'notDeclared'`, so a stale one absorbs the next regression there. No TS
  suppression carries a rule code; the prose reason is the only narrowing.
- **`skipLibCheck: true` disables it inside `.d.ts`.** TS2578 comes from the
  checking pass that flag skips, so a hand-written declaration file keeps stale
  directives with no diagnostic; `--skipLibCheck false` reports them.

`// @ts-ignore` never expires and never reports, and `// @ts-nocheck` silences a
whole file; both are lint territory (`mechanical-enforcement` owns oxlint's
`typescript/ban-ts-comment`, which also requires the prose reason).

## Regex literals are checked; `new RegExp` is not

tsc parses regular expression **literals** and reports what a reviewer misses -
`TS1532` for a backreference to a group that does not exist, `TS1515` for two
named groups that can both match, `TS1500` for a duplicate flag, plus
out-of-order ranges and quantifiers. Nothing inside
`new RegExp("(?<x>a)\\k<typo>", "gg")` is checked, the flags argument included.
The check is target-sensitive and suppressible: a named group under a `target`
below ES2018 is `TS1503`, and a `// @ts-expect-error` over a broken literal
counts as *used*, so one comment turns it off there and never expires.

## Deprecation carries its deletion condition

tsc reports nothing for a `@deprecated` symbol; the tag drives editor
strikethrough only. Put the replacement *and* the named deletion condition in
the message, so the marker carries the contract rather than a comment nobody greps:

```ts
/** @deprecated Use `parseEmail`; delete when the last v1 client retires (2026-12). */
export function validateEmail(raw: string): string { … }
```

A deprecation with no deletion condition is a permanent second code path;
migration mechanics belong to `refactoring`. The call-site gate,
oxlint's type-aware `typescript/no-deprecated` echoes that message verbatim.
`export *` still launders the symbol past it. See
`mechanical-enforcement/references/typescript.md`, Lint families and suppressions.

## JSDoc

Every exported function, class, method, constant, and usually exported type gets
JSDoc. Explain invariants, trade-offs, non-obvious rules, and safety
justifications - not what the code already says.

```ts
/**
 * Parse an email address from untrusted input.
 * @param input - The untrusted string to parse.
 * @returns A parsed email address, or `InvalidEmailAddress` when invalid.
 */
export function parse(input: string): Result<EmailAddress, InvalidEmailAddress>;
```

Use `@template` for generics and document the fields of complex exported object
types. `@throws` is for defects only, never for expected typed errors (`errors.md`).

## TypeScript testing specifics

Strategy, layers, and fakes-not-mocks are owned by `testing`, coverage by
`test-coverage`. TS-specific points:

- **Never `vi.mock` / `jest.mock`.** Use real seams: constructor-injected
  interfaces, Effect services and layers, a local DB, or in-memory fakes.
- Assert observable behaviour - returned value or error, persisted state,
  emitted event - not `expect(spy).toHaveBeenCalledWith`.
- **`fast-check`** for parsers, branded types, state machines, serialisation
  round-trips, normalisation, idempotence, and lawful combinators.
- Export arbitraries next to the domain module they support
  (`invoice-number.ts`, `invoice-number.test.ts`, `invoice-number.arbitrary.ts`).
- Never bypass a parser, smart constructor, or invariant to build a fixture.
- Prefer SQLite or a local DB over a hand-rolled fake where SQL, schema, or
  transaction behaviour is the thing under test.
