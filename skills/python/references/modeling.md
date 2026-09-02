# Modelling: illegal states, value objects, entities

## Which record type

Python spells "a record" six ways. Pick by what the value has to do:

| Form | Use for |
|---|---|
| `@dataclass(frozen=True, slots=True, kw_only=True)` | the default for domain values and entities; costs below |
| `TypedDict` | a real `dict` crossing a boundary - a JSON payload, `**kwargs`, a third-party shape |
| `NamedTuple` | only when the value genuinely is a tuple: positional unpacking, an index-addressed row |
| `attrs` | validators, converters, `on_setattr`, or `cached_property` on a slotted class (attrs 26.1.0 rewrites the descriptor, so it caches) |
| `pydantic.BaseModel` | the boundary parser, not every internal type; every construction re-validates - a `field_validator` fires on `M(x=1)`, not only on `model_validate` (ladder: `parsing.md`) |
| `msgspec.Struct` | when decode speed dominates |

`ReadOnly[T]` (PEP 705; `typing` from 3.13, `typing_extensions` below) makes a
`TypedDict` key unassignable; `closed=True` (PEP 728) narrows the type so a
wider dict is rejected where it is expected, spelled
`typing_extensions.TypedDict` because `typing.TypedDict` refuses the keyword up
to 3.14. Both need a checker that implements them - basedpyright 1.39.10 and
mypy 2.3.1 flag the read-only write and the wider-dict argument.

Trap: a `BaseModel` as the internal domain type drags validation cost and a
settable, dict-shaped object into the pure core. Parse at the edge instead.

## Illegal states unrepresentable

Model a lifecycle as a union of frozen dataclasses, each carrying its own data -
not one class with a bag of optional fields and booleans. Class patterns plus
`assert_never` exhaust the union with no tag field at all:

```python
type Invoice = Draft | Sent   # each a frozen dataclass holding only its own fields

def status_line(inv: Invoice) -> str:
    match inv:
        case Draft():          return "draft"
        case Sent(sent_on=on): return f"sent {on:%Y-%m-%d}"
        case _:                assert_never(inv)   # a later variant: cannot be assigned ... "Never"
```

A `Literal` tag field is not what makes the union exhaustive; it earns its place
only where the union is **serialised**, because a wire format has no classes:
`kind: Literal["draft"] = "draft"` on each DTO under
`Annotated[DraftDto | SentDto, Field(discriminator="kind")]`, or
`class DraftDto(msgspec.Struct, tag="draft")`, which defaults the tag field to
`type`. Inside the core, a tag field costs a slot and buys nothing.

Use `Literal` or `enum.StrEnum` for closed sets. Avoid boolean behaviour-flag
parameters; pass named options or a domain type - booleans are fine as
predicate return values. (Agnostic version: `architecture`.)

## The house dataclass, and what it costs

`@dataclass(frozen=True, slots=True, kw_only=True)` is the default. Each flag
buys something and charges for it.

**`frozen=True` blocks rebinding, not mutation.** `bag.lines = ()` raises
`FrozenInstanceError: cannot assign to field`; `bag.lines.append(x)` succeeds -
the list it points at is not frozen. A `list` field also makes the instance
unhashable (`unhashable type: 'list'`), so the value object silently stops
working as a `dict` key. Domain values hold `tuple`, `frozenset`, `Decimal`,
`date`; mutable defaults are ruff's `RUF008`/`RUF012` (`mechanical-enforcement`).

**`slots=True` costs three things**, ordered by distance from the decorator:

- `functools.cached_property` raises at first *access*, not at class definition:
  `TypeError: No '__dict__' attribute ... to cache`. Derived state on a slotted
  dataclass is a plain `@property`; reach for `attrs` when a cache really pays.
- Weak references need `weakref_slot=True`; without it `weakref.ref(x)` raises
  `TypeError: cannot create weak reference to ... object`.
- It builds and returns a **new** class, so a decorator-populated registry under
  the `@dataclass` line stores a class that `is not` the one callers import.
  Register the final class instead, or put `@register` outermost.

Zero-argument `super()` inside a slotted dataclass method raises
`TypeError: super(type, obj): obj must be an instance or subtype of type` on
3.12 and works from 3.13.

**`kw_only=True` earns its place twice.** A defaulted field does not force
defaults onto the fields after it, so `TypeError: non-default argument follows
default argument` cannot happen. And two fields of the same type stop being
swappable, because positional construction is refused outright:
`Transfer("alice", "bob")` raises `TypeError: ... takes 1 positional argument
but 3 were given`, a swap no checker catches. (`PLR0917` is the analogue for
plain functions; config: `mechanical-enforcement`.) Its cost: **keyword-only
fields are excluded from `__match_args__`**, which is then `()`, so match on
keyword patterns (`case Money(currency=c)`), never positional ones.

## Value objects

A value object is defined by its attributes and is immutable. Where an operation
between two values is only meaningful within a class of them, put that class in
the type and the illegal combination stops being expressible:

```python
class Currency:
    code: ClassVar[str]

@final                              # a tag is not subclassed; also satisfies
class GBP(Currency): code = "GBP"   # basedpyright's reportUnannotatedClassAttribute

@final
class USD(Currency): code = "USD"

@dataclass(frozen=True, slots=True, kw_only=True)
class Money[C: Currency]:
    currency: type[C]   # runtime value AND the type parameter, so codes survive serialisation
    minor_units: int    # integer minor units; a float amount loses pennies

    def __add__(self, other: "Money[C]") -> "Money[C]":   # no check: the checker rejects a mismatch
        return Money(currency=self.currency, minor_units=self.minor_units + other.minor_units)

fee = Money(currency=GBP, minor_units=250)   # inferred Money[GBP]
fee + Money(currency=USD, minor_units=100)   # error: Operator "+" not supported
```

Where the currency set is genuinely dynamic and has to stay a plain field, the
mismatch becomes a **defect**, so raise a domain-named error, never a bare
`ValueError`:

```python
class CurrencyMismatch(Exception): ...   # a caller bug, not a domain outcome

@dataclass(frozen=True, slots=True, kw_only=True)
class Money:
    currency: str       # dynamic set, so no type parameter can carry it
    minor_units: int

    def __add__(self, other: "Money") -> "Money":
        if self.currency != other.currency:
            raise CurrencyMismatch(self.currency, other.currency)
        return Money(currency=self.currency, minor_units=self.minor_units + other.minor_units)
```

That is `errors.md`'s defect vocabulary: nothing downstream branches on it, no
caller catches it. Express the rest of the domain semantics through dunder
methods (`__sub__`, `__gt__` for sort order) and `@property`.

## Entities

An entity has a stable identity that outlives its values: equal means same
identity, not same fields. Say so in the decorator - a hand-written `__eq__`
under a plain `@dataclass` **silently wins** over the generated one, hiding it:

```python
@dataclass(eq=False)   # without it, dataclass quietly skips generating __eq__ and says nothing
class Batch:
    reference: Reference  # identity

    @override
    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Batch):
            return NotImplemented
        return other.reference == self.reference

    @override
    def __hash__(self) -> int:   # defining __eq__ sets __hash__ to None; restore it explicitly
        return hash(self.reference)
```

`__hash__` heuristic: defining `__eq__` in a class body sets `__hash__` to
`None`, so the entity is unhashable until you say otherwise. Leave it that way
unless it goes into a `set` or a `dict` key; then hash the same immutable
identity `__eq__` compares. Never hash a mutable field - mutating it after
insertion strands the entry.

An entity is mutable by design, so it is the one place `frozen=True` is wrong.
Link it to other aggregates by id, not by embedding (`ports-persistence.md`).
