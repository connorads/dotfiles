# Parse, don't validate

Turn untrusted or loosely-typed input into domain types as early as practical,
and keep what you learned. Do not validate-and-discard.

```text
dict/JSON/bytes -> CreateUserDto -> CreateUserInput -> EmailAddress / UserId / ...
```

not raw `dict[str, Any]` threaded through the whole app.

## Naming preserves meaning

| Form | Use for |
|---|---|
| `parse_x(input) -> Result[X, ...]` | untrusted / loosely-typed input |
| `make_x(...)` / `create_x(...)` | smart constructor from already-typed pieces |
| `is_x(value) -> bool` | a true predicate (annotate `TypeGuard`/`TypeIs` when it narrows) |

Avoid `validate_x` when the function returns a refined value — it parsed
something; name it for what it produced. Pydantic `field_validator`s are the
exception: that *is* the parser, named by the library.

## Schemas as boundary parsers

Use a schema library at the boundary to produce refined/domain types and typed
errors — not as ad-hoc checks sprinkled through core logic.

**Ladder:** repo's established library > pydantic v2 (`BaseModel`,
`model_validate`, `field_validator`/`model_validator`, `computed_field`) >
msgspec (when decode speed dominates) > attrs + cattrs (structure/unstructure) >
a hand-written smart constructor for a small domain type when that is clearer.

```python
class CreateUserDto(BaseModel):
    email: str
    age: int

    @field_validator("age")
    @classmethod
    def _non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("age must be non-negative")
        return v
```

A schema library's primitives are pre-tested — don't re-test them. Test the rules
*you* add (validators, transforms, cross-field `model_validator`s); the engine is
not your code. A hand-written smart constructor, by contrast, is your logic — test
it. See the `testing` skill (Types Before Tests).

## Branded primitives — and where it stops

`typing.NewType` distinguishes meaningful ids at zero runtime cost:

```python
from typing import NewType
Sku = NewType("Sku", str)
Reference = NewType("Reference", str)
```

Construct a branded value only through its parser/smart constructor, so callers
cannot mint one from a raw string by accident. **But** Python is not TypeScript
here: brand where mix-ups genuinely bite (id collisions, units like
`Cents`/`Milliseconds`); accept a plain `str`/`int` where a wrapper is pure
ceremony. The Cosmic-Python authors deem `NewType` largely overkill for ordinary
fields, and mindless primitive-obsession in a dynamically typed language buys
complexity, not safety. Record the trade-off rather than wrapping everything.

## Push optionality and partiality outward

Avoid `Optional`/`None` parameters in functions that require a value — branch or
parse before calling. Prefer an explicit input dataclass per operation over a
loose `dict` or a pile of keyword arguments:

```python
@dataclass(frozen=True, slots=True)
class CreateUserInput:
    actor: AdminUser
    email: EmailAddress
    roles: tuple[Role, ...]
```
