# Modelling: illegal states, value objects, entities

## Illegal states unrepresentable

Model a lifecycle as a `Union` of frozen dataclasses, each carrying its own data
and a `Literal` tag — not one class with a bag of optional fields and booleans.
The compiler then forbids the invalid combinations:

```python
from dataclasses import dataclass
from typing import Literal, assert_never

@dataclass(frozen=True, slots=True)
class Draft:
    tag: Literal["draft"] = "draft"
    lines: tuple[LineItem, ...] = ()

@dataclass(frozen=True, slots=True)
class Sent:
    sent_at: Instant
    tag: Literal["sent"] = "sent"

type Invoice = Draft | Sent

def status_line(inv: Invoice) -> str:
    match inv:
        case Draft():        return "draft"
        case Sent(sent_at=at): return f"sent {at:%Y-%m-%d}"
        case _:              assert_never(inv)  # new variant -> type error
```

`assert_never` in the catch-all makes a forgotten branch a type error, not a
runtime surprise. Use `Literal`/`enum.StrEnum` for closed sets. Avoid boolean
behaviour-flag parameters; pass named options or a domain type. Booleans are fine
as predicate return values.

For closed unions parsed from input, pydantic's discriminated unions
(`Field(discriminator="tag")`) parse straight into the right variant.

## Value objects

A value object is defined by its attributes and is immutable.
`@dataclass(frozen=True, slots=True)` gives value-equality, hashability, and
immutability for free — the single most reusable Python modelling mechanic:

```python
@dataclass(frozen=True, slots=True)
class Money:
    currency: str
    amount: int  # minor units

    def __add__(self, other: "Money") -> "Money":
        if self.currency != other.currency:
            raise ValueError("cannot add different currencies")
        return Money(self.currency, self.amount + other.amount)
```

Express domain semantics through dunder methods (`__add__`/`__sub__` raising on
invalid operations, `__gt__` for sort order) and `@property` for derived state.

## Entities

An entity has a stable identity that outlives its attribute values; two entities
are equal when their identity matches, not their fields:

```python
@dataclass
class Batch:
    reference: Reference  # identity

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Batch):
            return NotImplemented
        return other.reference == self.reference

    def __hash__(self) -> int:
        return hash(self.reference)
```

`__hash__` heuristic: leave it as the default (identity hash) unless the entity is
actually used in a `set`/`dict` *by value*; only then base it on a read-only id.
Never hash on a mutable field — mutating it after insertion corrupts the
container. Defining `__eq__` on a plain class drops the default `__hash__`, so set
it explicitly when membership is needed.
