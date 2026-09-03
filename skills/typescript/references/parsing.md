# Parse, don't validate

Turn `unknown` input into domain types as early as practical, keeping what you
learned. Never validate-and-discard; never thread `z.infer<S>` through the app.

```text
unknown -> HttpBodyDto -> CreateUserInput -> EmailAddress / UserId / ...
```

## Naming preserves meaning

| Form | Use for |
|---|---|
| `parseX(input): Result<X, ParseXError>` | untrusted / loosely-structured input |
| `makeX(...)` / `createX(...)` | smart constructor from already-typed pieces |
| `isX(value): value is X` | a predicate; plain `boolean` when it refines nothing |
| `assertX(...)` | rare - tests / framework boundaries only |

Avoid `validateX` when the function returns a refined value - it parsed
something; name it for what it produced. `Result`/`ok`/`err` come from
`errors.md`, Result shape.

## Narrowing predicates

`value is X` is the default because it is the only way a caller learns the check
happened; with plain `boolean` every call site re-checks or reaches for the `as`
this house rations. `boolean` stays right when it refines nothing (`isWeekend`).

**The negative branch narrows only over a union.** TypeScript subtracts in the
`else` by filtering members out of a union, so refining a non-union parameter to
an intersection leaves the `else` at the full input type, silently, at exit 0:

```ts
type ActiveUser = { readonly kind: "active"; readonly id: string };
type BannedUser = { readonly kind: "banned"; readonly reason: string };
type User = ActiveUser | BannedUser;
export const isActive = (u: User): u is ActiveUser => u.kind === "active";
export const label = (u: User): string => (isActive(u) ? u.id : u.reason);
```

Reading `u.reason` in the `else` proves it (verified 2026-09-03, tsc 7.0.2);
over a non-union `User` refined to `User & { status: "active" }` the `else`
stays `"active" | "banned"`. See `modeling.md`, Illegal states as tagged unions.

- **A predicate body is unchecked**, same risk class as `as`: the inverted
  `u.kind === "banned"` compiles clean. Two things fail closed - a predicate
  type not assignable to the parameter is `TS2677`, a misspelt name `TS1225`.
- **Inferred predicates are conditional.** With no return annotation, exactly
  one `return`, and no aliasing or mutation of the parameter, tsc infers
  `x is T` and `filter` narrows. Alias it (`const t = x;`) or add a second
  `return` and it reverts to `boolean` - `TS2322` only if the caller annotates.
- **`asserts x is T` needs a `function` declaration**, never a `const` arrow:
  every call site is then `TS2775` ("Assertions require every name in the call
  target to be declared with an explicit type annotation"). The throwing form
  belongs to `errors.md`, Panic helpers - the defect vocabulary.

## Schemas as boundary parsers

A schema library belongs at the boundary, producing refined types and typed
errors, not ad-hoc validators through core logic. **Ladder:** the repo's
established library > effect `Schema` (Effect repos) > Standard Schema for
generic helpers > zod 4 > valibot where size decides > a hand-written smart
constructor. Versions: `toolchain.md`, Library facts; `Schema.*`: `skl effect`.

```ts
// effect Schema v4: decodeUnknownResult returns the same Result the core uses.
const User = Schema.Struct({ email: Schema.String, age: Schema.Number });
export const parseUser = Schema.decodeUnknownResult(User, {
  onExcessProperty: "error",
});
// zod 4: safeParse returns a discriminated union; bare parse throws.
const ZUser = z.strictObject({ email: z.email(), age: z.int() });
```

**All three drop unknown keys by default**, so a renamed field arrives as a
missing one and the parse still succeeds (verified 2026-09-03 on effect
4.0.0-rc.112, zod 4.5.4, valibot 1.4.2). Spell `z.strictObject`/`v.strictObject`
or `{ onExcessProperty: "error" }`. Test only the rules *you* add - a library's
primitives are pre-tested; a smart constructor is yours (`testing` skill).

## Branded types

Brand a primitive so a raw string or number cannot reach a domain slot.

```ts
export type EmailAddress = Brand<string, "EmailAddress">;
/** Parse an email address from untrusted input. */
export function parse(input: string): Result<EmailAddress, InvalidEmailAddress> {
  const normalised = input.trim().toLowerCase();
  if (!isValid(normalised)) return err(new InvalidEmailAddress(input));
  // SAFETY: TypeScript cannot express the brand. parse checked the normalised
  // string before branding; callers cannot construct EmailAddress except here.
  return ok(normalised as EmailAddress);
}
```

Construct branded values **only** through their parser. The `as` inside it, with
its `// SAFETY:` note, is the one sanctioned spot; an `as` at a call site mints an
unchecked value. Candidates: ids, parsed strings, constrained numbers, units.

## Push optionality and partiality outward

Two moves make a partial function total: constrain the input to a parsed or
branded value, or widen the output to a `Result`. Prefer constraining, which
deletes the branch for every caller rather than adding one to each. A parameter
defaulting to `undefined` is a partial function wearing a total signature; split
it into the two operations it is. Avoid `Partial<T>` as domain input unless
partiality is the domain concept - write a `readonly` input type per operation
(`modeling.md`, Which record type, settles how to spell it).
