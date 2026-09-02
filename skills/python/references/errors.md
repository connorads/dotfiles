# Errors and failures

Expected failures are values. Defects raise. Keep the two vocabularies distinct.

## Result shape

The house default, unless the repo already has a convention: a frozen tagged
union plus four free functions in `result.py`, no library.

```python
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Generic, TypeVar

# Covariant legacy TypeVars: PEP 695's `class Err[E]` infers invariance from the
# dataclass field (`frozen=True` included), so propagation would need a rewrap.
T_co = TypeVar("T_co", covariant=True)
E_co = TypeVar("E_co", covariant=True)

@dataclass(frozen=True, slots=True)
class Ok(Generic[T_co]):
    value: T_co

@dataclass(frozen=True, slots=True)
class Err(Generic[E_co]):
    error: E_co

type Result[T, E] = Ok[T] | Err[E]

# Free functions cover both variants; `map_ok` not `map`, which shadows the
# builtin module-wide (ruff A001, not enabled by the house select).
def map_ok[T, U, E](r: Result[T, E], f: Callable[[T], U]) -> Result[U, E]:
    return Ok(f(r.value)) if isinstance(r, Ok) else r

def and_then[T, U, E](r: Result[T, E], f: Callable[[T], Result[U, E]]) -> Result[U, E]:
    return f(r.value) if isinstance(r, Ok) else r

def map_err[T, E, F](r: Result[T, E], f: Callable[[E], F]) -> Result[T, F]:
    return r if isinstance(r, Ok) else Err(f(r.error))

def traverse[T, E](rs: Iterable[Result[T, E]]) -> Result[tuple[T, ...], E]:
    out: list[T] = []
    for r in rs:
        if isinstance(r, Err):
            return r
        out.append(r.value)
    return Ok(tuple(out))
```

Function-level PEP 695 is the house form; the classes are the exception, for the
variance above (`toolchain.md` owns the version floor). Keep error unions precise
at module boundaries (`Result[User, UserNotFound | UserStoreUnavailable]`), a
broad `AppError` for entrypoints and rendering only. Consume in two steps:

```python
match find_active(email):
    case Ok(user):
        return render(user)
    case Err(error):
        match error:
            case UserNotFound(): return http_404()
            case UserStoreUnavailable(): return http_503()
            case _: assert_never(error)
```

`case Err(UserNotFound())` is the trap: a pattern nested inside `Err` narrows
nothing, so the catch-all still sees `Err[UserLookupError]` and `assert_never` is
a type error even with every variant handled (`modeling.md` owns exhaustiveness).

### Which Result is a type-checker decision

Ladder: repo convention > the tagged union above > a library the repo's gating
checker can read > a bare `T | DomainError`, which has nothing to map over and
collapses when a success value is itself an error type. `returns` hides its
combinators behind a **mypy plugin**, invisible to the basedpyright gate
`mechanical-enforcement` specifies: keep the union there, `returns` only in a
mypy repo, `expression` where the checker is not fixed (`toolchain.md` has the
library facts).

## Composing fallible steps

Pick the form by what the next step needs, not by dogma.

### Chain when each step needs only its predecessor

`and_then(map_err(parse_sku(raw), MalformedLine), price)` maps the first step
into the declared channel, then continues. Python has no `?` and no method
chaining on a bare union: a third link nests deeper than it reads, so two is the
practical limit.

### Ladder the moment a later step needs more than its predecessor

The preferred form, not a fallback: every earlier value stays in scope, which a
chain of closures does not. Guard each step with `isinstance(step, Err)` and
return early - the bare `Err` widens, since `Err` is covariant in `E` - or
`map_err(step, InvalidActor)` to move its error into the seam's channel.
`isinstance` narrows; `match` belongs at the consuming end.

### Many Results into one

`traverse(line_total(r) for r in raws)` collapses `Iterable[Result[T, E]]` into
`Result[tuple[T, ...], E]`, keeping the first failure; the loop that appends
successes and logs failures ships a partial success no caller can distinguish.

### One error channel

Declare the seam's error union and map each step into it. `and_then` joins the
two channels by itself - `Result[int, A]` chained with a step returning
`Result[str, B]` infers `Ok[str] | Err[A | B]` - so an unmapped pipeline grows a
member per step until no caller can branch on it. Annotate the declared return
type and an unmapped step is a type error: `"A | B" is not a subtype of "A"`.

### Fail fast or accumulate

Fail fast for dependent steps: step two needs step one's value, so there is
nothing to accumulate. Independent validations are the schema's job -
`Err(InvalidSignUp(tuple(e.errors())))` under `except ValidationError` carries
every bad field from one pass - so reach for the parser (`parsing.md`) instead.

### Raise inside a module, translate at its seam

Six fallible steps inside one module do not need six `Err` returns: let the
private steps raise, and make the public function total by catching once into the
union callers branch on.

```python
def place_order(cmd: PlaceOrder) -> Result[OrderPlaced, UnknownSku | OutOfStock]:
    try:
        reserved = _reserve(_parse_basket(cmd.lines))
    except (UnknownSku, OutOfStock) as e:   # named types; a defect must still crash
        return Err(e)
    return Ok(OrderPlaced(skus=reserved))
```

The test is escape, not layer: exceptions are legitimate control flow *within* a
module, never across its public surface (`architecture` sanctions the split).
Catching `Exception` or a library's base class turns your own `TypeError` into a
domain error; keep the raising steps private, or an outside caller meets a raise.

## Domain errors named in the ubiquitous language

Expected failures get a tag (the class itself), a useful message and structured
context, named for the business outcome rather than the mechanism; annotate that
context (`self.sku: Sku = sku`), since basedpyright `recommended` warns on an
unannotated attribute of a non-final class. Subclassing `Exception` costs
nothing when the value is returned as `Err(...)` and buys the seam above.

## Translate exceptions at the shell

Boundaries raise - `StopIteration`, `KeyError`, ORM integrity errors, HTTP and
socket errors. Catch them at the shell and translate to a domain value or error
(`raise OutOfStock(line.sku) from None` for a control-flow signal, `from err` to
keep an unexpected cause); one reaching the pure core is control flow the core
cannot type. Inside a task group a failure arrives wrapped in an `ExceptionGroup`
even when exactly one child failed, so a plain `except OutOfStock` stops
matching: catch the group and `split` it (`concurrency.md`). `except*` cannot -
`return` inside an `except*` block is a `SyntaxError`.

## Panic vocabulary - defects raise

- `raise NotImplementedError` for stubs.
- `assert_never(x)` on an exhaustive `match` catch-all (a forgotten variant is a
  type error, see `modeling.md`).
- A bare `assert` documents an invariant in dev, but it is stripped under `-O` -
  never use it for input validation or security checks; parse instead.

## What a docstring's failure note says

A `Raises:` note documents what the signature cannot, which is two cases: a
defect path, and the exception-first interior of a seam module, whose private
steps raise by design. A function returning `Result[T, E]` names its failures in
`E` already; prose repeating them drifts from what the checker enforces.

## Sensitive values

Never put secrets (tokens, keys, passwords) in errors, traces, logs or snapshots.
Wrap them at the boundary - pydantic's `SecretStr`, or a `Redacted` wrapper whose
`__repr__`/`__str__` masks the value - and unwrap only inside the adapter making
the external call. Telemetry carries safe fields only: domain ids, operation and
provider names, state tags, error tags (observability: `architecture`).
