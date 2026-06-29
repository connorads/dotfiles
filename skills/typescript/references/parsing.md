# Parse, don't validate

Turn `unknown` or loosely-structured input into domain types as early as
practical, and keep what you learned. Do not validate-and-discard.

```text
unknown -> HttpBodyDto -> CreateUserInput -> EmailAddress / UserId / ...
```

not `unknown -> z.infer<typeof Schema>` threaded through the whole app.

## Naming preserves meaning

| Form | Use for |
|---|---|
| `parseX(input): Result<X, ParseXError>` | untrusted / loosely-structured input |
| `makeX(...)` / `createX(...)` | smart constructor from already-typed pieces |
| `isX(value): boolean` | a true predicate |
| `assertX(...)` | rare — tests / framework boundaries only |

Avoid `validateX` when the function returns a refined value — it parsed
something; name it for what it produced.

## Schemas as boundary parsers

Use a schema library at the boundary to produce refined/domain types and typed
errors — not as ad-hoc validators sprinkled through core logic.

**Ladder:** repo's established library > Effect `Schema` (Effect repos) >
Standard Schema-compatible for generic helpers > Zod 4 > hand-written smart
constructors for small domain types when clearer.

A schema library's primitives are pre-tested — don't re-test them. Test the rules
*you* add (refinements, transforms, cross-field constraints) and that the schema
matches what the producer actually sends; the engine is not your code. A
hand-written smart constructor, by contrast, is your logic — test it. See the
`testing` skill (Types Before Tests).

## Branded types

Brand meaningful primitives so a raw string/number can't be passed where a
domain value is required.

```ts
export type EmailAddress = Brand<string, "EmailAddress">;

/** Parse an email address from untrusted input. */
export function parse(input: string): Result<EmailAddress, InvalidEmailAddress> {
  const normalized = input.trim().toLowerCase();
  if (!isValid(normalized)) return err(new InvalidEmailAddress(input));
  // SAFETY: TypeScript cannot express the brand. parse checked the normalized
  // string before branding; callers cannot construct EmailAddress except here.
  return ok(normalized as EmailAddress);
}
```

Construct branded values **only** through their parser/smart constructor — never
an `as` cast at the call site (the `as` inside the parser is the one sanctioned
spot, with its `// SAFETY:` note). Candidates: IDs (`UserId`, `OrgId`), parsed
strings (`EmailAddress`, `Url`, `NonEmptyString`), constrained numbers
(`PositiveInt`, `Cents`), units (`Milliseconds`, `Bytes`).

## Push optionality and partiality outward

Avoid optional/nullable parameters in functions that require a value — branch or
parse before calling. Avoid `Partial<T>` as domain/application input unless
partiality is the real domain concept; prefer an explicit input type per
operation.

```ts
type CreateUserInput = {
  readonly actor: AdminUser;
  readonly email: EmailAddress;
  readonly roles: ReadonlyArray<Role>;
};
```
