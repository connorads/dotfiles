# Conventions: types, JSDoc, testing

## Cast / `any` / `!` discipline

The strict tsconfig flags and the no-`any`/no-`as`/no-`!` lint rules are owned by
`mechanical-enforcement` — that is where the config lives. The *idioms* this
skill cares about:

- No `any`; use `unknown` + narrowing.
- No `!` non-null assertion; branch, parse, or refine instead.
- No `as Type` casts. `as const` is fine. A non-`as const` cast is a last resort
  for brand internals or interop the type system can't express, and needs a
  Rust-style safety comment:

```ts
// SAFETY: TypeScript cannot express the brand. parse checked the normalized
// string before branding. Callers cannot construct EmailAddress except here.
return normalized as EmailAddress;
```

- Rare `any` in a generic helper also needs a targeted lint-ignore + reason.
- Prefer immutable values (`readonly`, `ReadonlyArray`); mutation is fine inside
  localised shell code, builders, or perf-sensitive internals behind a precise
  interface.

## JSDoc

Every exported function, class, method, constant, and usually exported type gets
JSDoc. Explain invariants, trade-offs, non-obvious rules, and safety
justifications — not what the code already says.

```ts
/**
 * Parse an email address from untrusted input.
 *
 * @param input - The untrusted string to parse.
 * @returns A parsed email address, or `InvalidEmailAddress` when invalid.
 */
export function parse(input: string): Result<EmailAddress, InvalidEmailAddress>;
```

Use `@template` for generics; document fields of complex exported object types.
Use `@throws` only for defects / `notYetImplemented`, never for expected typed
errors.

## TypeScript testing specifics

Strategy, layers, and the fakes-not-mocks principle are owned by the `testing`
skill; coverage by `test-coverage`. TS-specific points:

- **Never `vi.mock` / `jest.mock`.** Use real seams: constructor-injected
  interfaces/classes, Effect services/layers, SQLite/local DB substitutes, or
  in-memory fakes for simple adapters.
- Assert observable behaviour (returned value/error, persisted state, emitted
  event, sent-email record in a fake) — not `expect(spy).toHaveBeenCalledWith`.
- **`fast-check`** for parsers, branded/refined types, state machines,
  serialisation round-trips, normalisation/idempotence, lawful combinators.
- Export arbitraries next to the domain module they support:

```text
src/billing/
  invoice-number.ts
  invoice-number.test.ts
  invoice-number.arbitrary.ts
```

- Tests must not bypass parsers, smart constructors, or invariants to build
  fixtures.
- For persistence behaviour, prefer SQLite/local DB over hand-rolled fakes when
  SQL/schema/transaction behaviour matters.
