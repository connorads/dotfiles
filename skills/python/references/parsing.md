# Parse, don't validate

Turn untrusted or loosely-typed input into domain types as early as practical
and keep what you learned. Do not validate-and-discard, and do not thread a raw
`dict[str, Any]` through the app.

```text
dict/JSON/bytes -> CreateUserDto -> CreateUserInput -> EmailAddress / UserId / ...
```

## Naming preserves meaning

| Form | Use for |
|---|---|
| `parse_x(input) -> Result[X, ...]` | untrusted / loosely-typed input |
| `make_x(...)` / `create_x(...)` | smart constructor from already-typed pieces |
| `is_x(value) -> bool` | a true predicate (annotate `TypeIs` when it narrows - see `conventions.md`) |

Avoid `validate_x` when the function returns a refined value - it parsed
something; name it for what it produced. Pydantic `field_validator`s are the
exception: that *is* the parser, named by the library.

## Schemas as boundary parsers

Use a schema library at the boundary to produce refined/domain types and typed
errors - not as ad-hoc checks sprinkled through core logic.

**Ladder:** repo's established library > pydantic v2 (`BaseModel`, `model_validate`,
`field_validator`/`model_validator`, `computed_field`) > msgspec (when decode speed
dominates) > attrs + cattrs > a hand-written smart constructor for a small domain type.

Target pydantic v2 for new boundaries; 2.13.5 is the line these snippets run on,
and perishable version facts live in `toolchain.md`. The V1 maintenance line
(1.10.26) imports and validates on 3.14 - a migration decision, not a deadline.

### Make the boundary correct by construction

Set the two config keys no linter can substitute for:

```python
class CreateUserDto(BaseModel):
    # strict: refuse cross-type coercion, so "42" never becomes 42 behind your back.
    # extra="forbid": an unknown key is a caller bug; the default drops it silently.
    model_config = ConfigDict(strict=True, extra="forbid")

    email: str
    age: int

    @field_validator("age")
    @classmethod
    def _non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("age must be non-negative")
        return v
```

- **Strict mode is JSON-aware, so parse the bytes, not a `dict`.**
  `model_validate_json(raw)` reads `"2026-09-02T10:00:00Z"` into a `datetime`
  (JSON has no datetime type); the same string on an already-decoded `dict` is
  rejected (`datetime_type`), so a `json.loads` in front costs you those
  JSON-native conversions.
- **Strict does not disable your own validators.** It refuses only to change a
  value's *type*, so a `BeforeValidator` normalising `str` to `str` runs as usual.

Test the rules *you* add - validators, transforms, cross-field
`model_validator`s - not the library's pre-tested primitives; a hand-written
smart constructor is your logic, so test it (`testing` skill, Types Before Tests).

## Branded primitives

**`typing.NewType` brands statically only - the brand is erased at runtime.**
`TypeAdapter(UserId).validate_python("42")` returns a plain `int`, and msgspec
decodes a `NewType` the same way: a parser validates against the supertype and
hands back the supertype's value, so the wrapper contributes no rule of its own.
Use `NewType` for an id whose only rule is "do not mix these up":

```python
Sku = NewType("Sku", str)
Reference = NewType("Reference", str)
```

**An `Annotated` alias is the carrier when the type has a rule** - one name that
is simultaneously the static type and the runtime parser:

```python
type Slug = Annotated[
    str,
    BeforeValidator(lambda s: s.strip().lower()),   # normalise FIRST
    StringConstraints(pattern=r"^[a-z0-9-]+$"),     # then constrain
]
```

The ordering is load-bearing. `StringConstraints` applies `pattern` to the
**raw** input, not to the value its own `strip_whitespace`/`to_lower` produces,
so that constraint alone rejects `"  Hello-World "`; with the `BeforeValidator`
first, the same input parses to `'hello-world'`.

An `Annotated` alias is not a static brand: a bare `str` is assignable to `Slug`.
Wrap it in a `NewType` for both halves - `Sku = NewType("Sku", Slug)` keeps the
runtime rule *and* makes `ship(raw_str)` a type error. Construct a branded value
only through its parser, so callers cannot mint one from a raw string.

**Where it stops.** Brand where mix-ups genuinely bite: id collisions, units
(`Cents`/`Milliseconds`), and any string with a shape (`Slug`, `EmailAddress`).
A field with no rule and no look-alike sibling gains nothing but an import.

## Injection-shaped APIs

`LiteralString` (PEP 675, 3.11) is Python's one type-level injection guard: a
checker rejects any `str` built from input, so put it on every SQL or shell sink
whose signature you own - `mechanical-enforcement` bans the rest. PEP 750
t-strings are the target state, gated on SQLAlchemy's construct being `tstring()`,
not `text()`, and arriving in 2.1 (`2.1.0rc1` against a `2.0.52` stable line), and
on ruff calling a t-string `invalid-syntax` below a `requires-python` of `>=3.14`.

## Push optionality and partiality outward

Two moves make a partial function total: constrain the input to a parsed or
`NewType` value, or widen the output to a `Result`. Prefer constraining, which
deletes the branch for every caller rather than adding one to each. `None` is
not an error channel - `-> User | None` cannot say whether the user was absent
or the store was down, and Python makes it worse because `None` is also a legal
stored value - and `-> None` from core logic hides a mutation, so return the new
value or the events instead. A parameter defaulting to `None` is a partial
function wearing a total signature: split it into the two operations it is, and
branch or parse before calling a function that requires a value.

Prefer an explicit input dataclass per operation over a loose `dict` or a pile
of keyword arguments:

```python
@dataclass(frozen=True, slots=True, kw_only=True)
class CreateUserInput:
    actor: AdminUser
    email: EmailAddress
    roles: tuple[Role, ...]
```

`modeling.md` owns the record-type choice and what each flag buys.
