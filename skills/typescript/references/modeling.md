# Modelling: records, illegal states, entities, collections

How a domain value is spelled decides what the compiler can refuse; the agnostic
principle is `architecture` SKILL.md, "Domain Modelling". Diagnostics are
verified 2026-09-03 against the floors in `toolchain.md`; the flags belong to `mechanical-enforcement` and
are named here as a cause, never configured.

## Which record type

Default: `interface` for an object shape, `type` for a union or a mapped type.
Reach past that default only for what the other rows buy.

| Form | Buys | Costs |
|---|---|---|
| `interface Order { … }` | the default object shape; `extends`, `implements` | its declaration scope can reopen it silently |
| `type Order = { … }` | unions, mapped and conditional types; a closed record | a duplicate declaration is TS2300 |
| `class Money` + a read `#private` field | nominality between look-alike classes; behaviour on the value | the prototype does not survive a repository round trip |
| brand (`string & { readonly [brand]: "OrderId" }`) | nominality on primitives and plain records, free at runtime | construct only through a parser |
| `readonly` field, `readonly T[]` | compile-time immutability: TS2540, TS4104 | no runtime effect, and shallow |
| `as const satisfies T` | keeps literal types and checks them against `T` | the target rewrites nested readonly-ness |
| `Object.freeze` | the runtime half; emits as `Readonly<T>` in a `.d.ts` | one level deep; a write outside strict mode is ignored, not thrown |

Brands and smart constructors: `references/parsing.md`, "Branded types"; the one
sanctioned `as` and its `// SAFETY:` note: `references/conventions.md`,
"Cast / `any` / `!` discipline".

**The implicit index signature keys on where the members are declared, not on the
keyword.** An interface's own members produce none, so it is not assignable to
`Record<string, unknown>`: `TS2322: Type 'IOrder' is not assignable to type
'Record<string, unknown>'. Index signature for type 'string' is missing in type
'IOrder'`. `type AliasOfInterface = IOrder` fails identically, so the `type`
keyword alone buys nothing, while `interface EmptyExt extends TOrder {}` over an
object-literal alias is accepted. A DTO that has to flow into an index-signature
type therefore declares its members in a type alias.

**Declaration merging is a safety property, not a style one.** A second
`interface Reopenable { … }` in the same declaration scope merges with zero diagnostics; a second
`type Closed = { … }` is `TS2300: Duplicate identifier 'Closed'`. Extensibility
is the point for a shape third parties implement, and the reason a closed domain
record is a `type`. Another module needs explicit module augmentation or a global declaration.

**Nominality has two spellings.** A brand rejects the raw primitive:
`TS2322: Type 'number' is not assignable to type 'Cents'`. A class needs a
`#private` field that is genuinely **read** - an identically shaped `Cash` then
fails with `TS2322: … Property '#cents' in type 'Cash' refers to a different
member that cannot be accessed from within type 'Money'`, and an object literal
with `TS2741: Property '#cents' is missing`. A declare-only marker does not
survive the house flags: `readonly #brand = "Order"` with no reader is
`TS6133: '#brand' is declared but its value is never read`. Without the read
field the class is structural and a bare object literal assigns to it.

**`as const satisfies T` keeps literals but not readonly-ness.** With
`type Rate = { code: string; tags: string[] }`, the checker prints
`[{ code: "GBP", tags: ["x"] }] as const satisfies readonly Rate[]` as
`readonly [{ readonly code: "GBP"; readonly tags: ["x"] }]` - `tags` is a mutable
tuple, because the satisfies target applies as a contextual type; plain `as
const` gives `readonly ["x"]`. Literal preservation is real and checked:
`const bad: Code = "USD"` against `type Code = (typeof RATES)[number]["code"]`
is `TS2322: Type '"USD"' is not assignable to type '"GBP"'`.

**Domain classes assign fields in the body.** `constructor(private readonly
cents: number) {}` is `TS1294: This syntax is not allowed when
'erasableSyntaxOnly' is enabled`; declare `readonly #cents: number` and assign it
in the constructor instead.

## Illegal states as tagged unions

Model lifecycle states as tagged unions, not boolean bags. Avoid boolean
behaviour-flags in parameters; use named options or domain types. Booleans are
fine as predicate *return* values.

The union moves two checks from review to the compiler. Reading a variant's field
off the union is `TS2339: Property 'sentAt' does not exist on type 'Invoice'`,
where the bag spelling `{ sent: boolean; sentAt?: Instant }` types `sentAt` as
`Instant | undefined` and leaves the correlation to a reviewer. And a later
variant reaches the `assertNever` on the `default` branch:

```ts
export const summary = (inv: Invoice): string => {
  switch (inv._tag) {
    case "Draft": return `draft with ${inv.lines.length} lines`;
    case "Sent": return `sent at ${inv.sentAt}`;
    default: return assertNever(inv);
  }
};
```

Adding a `Void` variant is then `TS2345: Argument of type '{ readonly _tag:
"Void"; … }' is not assignable to parameter of type 'never'`, which names the
variant nobody handled. Give each variant only its own fields, so the data a
state does not have cannot be read.

## Entities: compare by id, never by the object

JavaScript objects have no structural value equality. `===` is reference identity and `Map`/`Set` key
on SameValueZero, so `new Map([[{ id: 1 }, "x"]]).get({ id: 1 })` is
`undefined`. An entity therefore compares and indexes by its branded id:

```ts
export type Order = { readonly id: OrderId; readonly total: number };

export const sameOrder = (a: Order, b: Order): boolean => a.id === b.id;
export const byId = (os: readonly Order[]): ReadonlyMap<OrderId, Order> =>
  new Map(os.map((o) => [o.id, o]));
```

Brand each entity's id separately: with `ShipmentId` distinct from `OrderId`,
`sameOrder(order, shipment)` is `TS2345: … Type 'ShipmentId' is not assignable to
type 'OrderId'`. A shared `Brand<string, "Id">` accepts the mix-up.

**Identity must not live in a method.** `JSON.parse(JSON.stringify(order))` and
`structuredClone(order)` both return an object with `Object.prototype`, not the class's custom prototype: `instanceof Order`
is `false` and `order.equals` is `undefined`, so calling it throws
`TypeError: row.equals is not a function`. JSON parsing is accepted through `any`;
`structuredClone<T>` promises the input type despite losing its prototype. The failure surfaces at the repository boundary
doing the round trip (`references/modules.md`, "Repositories and persistence").
Effect's `Equal`/`Hash` protocol is the rung above a comparison function; the
vendored `effect` skill owns it (`skl effect`).

## Value objects: compare by fields

A value object has no identity, so the entity rule inverts: two instances with
equal fields are the same value, and the cheap spelling is a canonical string or
a field-by-field `equals`. Equality and immutability are separate opt-ins.
`readonly` is compile-only - `TS2540: Cannot assign to 'a' because it is a
read-only property` - and `Object.freeze` is the runtime half, one level deep:
tsc accepts `nested.b = 99` on `Object.freeze({ a: 1, nested: { b: 2 } })` and
the supported runtime performs it. Freeze at construction, and hold immutable members only.

## Collections in signatures

Take `readonly T[]`. Return `readonly T[]` for a value the caller must not
mutate, `T[]` only for one it owns outright - a blanket `T[]` return leaks a
mutable alias to internal state. Arrays are covariant, and unsoundly so:
`const asEmployees: Employee[] = managers` compiles clean at full strictness, and
a `push` through that alias corrupts `managers`. `{ readonly items: T[] }` assigns
the same way, so `box.items.push(…)` reaches the original through a field that
looks immutable. A `readonly T[]` parameter blocks it one way only - `readonly
Employee[]` back to `Employee[]` is `TS4104: The type 'readonly Employee[]' is
'readonly' and cannot be assigned to the mutable type 'Employee[]'` - and the
promise is shallow:
`safe[0]!.name = "mutated"` compiles. No compiler flag makes array variance sound,
and the type-aware lint rule for a mutable parameter needs a side-by-side checker
alongside (`references/toolchain.md`), so this rests on habit and review.

`Iterable<T>` does not promise repeatability. A generator object yields nothing
on its second traversal, while an array is repeatable. Take `readonly T[]` when
repeatability is part of the contract.
