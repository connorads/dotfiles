# Ports, persistence, and the composition root

## Protocol vs ABC for ports

Default to a `typing.Protocol` (`add`/`get` on a `BatchRepository`, say):
structural typing lets the port name the *narrowest* slice a caller needs,
because an adapter satisfies it by shape with no subclassing. Reach for
`abc.ABC` only when nominal enforcement or shared behaviour earns it; an ABC
with neither is deleted when a second adapter does not fit it. A single-method
dependency's port is a plain `Callable`.

## Persistence ignorance

Keep domain classes as plain Python objects with **no ORM base class** and no
persistence methods: SQLAlchemy's imperative (classical) mapper makes your ORM
import your model, inverting the dependency the way `architecture` wants. A
`Repository` presents stored aggregates as an in-memory collection
(`add`/`get`); a `Unit of Work` bundles repositories under one atomic commit.
Link aggregates by id (`workspace_id: int`), never by embedding, and parse rows
back into domain types on the way out - a row is untrusted input like any other,
your own writer's included (`parsing.md`).

### The SELECT N+1 gotcha

Lazy-loaded ORM object graphs fire a query on *every dotted attribute access*,
so a loop over `account.workspaces[...].documents` explodes into hundreds of
queries, with no signal in the type or the traceback and latency proportional to
result count. On read-heavy paths use eager loading
(`selectinload`/`joinedload`) or one hand-written query, the first step to a
CQRS read model.

## Configuration at the boundary

Parse configuration once, in the composition root, into one frozen typed value,
and refuse to start on bad config; independent field validations are the case
where accumulating every error beats failing on the first (`errors.md`).

The shape is a `pydantic_settings.BaseSettings` subclass with typed fields
(`database_url: str`, `stripe_key: SecretStr`, `request_timeout: float = 5.0`)
under one `model_config = SettingsConfigDict(frozen=True, env_prefix="APP_",
extra="forbid")`. `frozen=True` makes a later write a `ValidationError` rather
than a value that changes under a request. `extra="forbid"` rejects an unknown
key from a `.env` file or a constructor argument, and that is its whole reach:
on pydantic-settings 2.15.0 the environment source collects only the variables a
declared field names, so a mistyped `APP_HTTP_TIMEOUT` is never seen and
`request_timeout` silently keeps its default - where the environment is the only
source, a field with no default is the honest guard. `SecretStr` keeps the
credential out of `repr()` and `model_dump_json()`; `get_secret_value()` is the
one unwrap, at the adapter needing it.

Nothing outside the composition root touches `os.environ` or `os.getenv`;
`mechanical-enforcement`'s `python-purity.toml` bans both in the core through
ruff `TID251`, so an adapter reading the environment behind the root's back
stays a review finding. Do not exempt the settings module with a second negated
`per-file-ignores` entry for `TID251`: two negated entries for one rule match
every file between them, disabling the rule everywhere with no warning. The
settings module sits in the shell, outside the glob the ban is scoped to, so it
needs no exemption. `architecture`'s `configuration-lifecycle.md` owns the other
two lifetimes through that door: rotating secrets, runtime-adjustable values.

## The composition root is a scope

Wire everything in one composition root that constructs the real adapters and
returns the configured app; it is also the single place a test substitutes
fakes. **Never put a constructed dependency in a default argument**:
`bootstrap(uow = SqlAlchemyUnitOfWork())` evaluates the constructor when the
`def` statement runs, at import, so importing the module opens the connection
and every call shares that instance - the import-time side effect this page bans
(`modules.md`), wearing the syntax of a default. Make the root an
`@asynccontextmanager` over an `AsyncExitStack` instead: acquisition order is
code order, release its exact reverse whether the body returns or raises.

```python
@asynccontextmanager
async def build(settings: Settings) -> AsyncIterator[App]:
    async with AsyncExitStack() as stack:
        engine = create_async_engine(settings.database_url)
        stack.push_async_callback(engine.dispose)   # no __aenter__; register the closer
        http = await stack.enter_async_context(httpx.AsyncClient(timeout=settings.request_timeout))
        tg = await stack.enter_async_context(asyncio.TaskGroup())   # background work
        yield App(orders=SqlOrders(engine=engine), spawn=tg.create_task,
                  payments=StripePayments(http=http, key=settings.stripe_key))
```

A SQLAlchemy `AsyncEngine` has no `__aenter__`, so `enter_async_context(engine)`
is a `TypeError`; `push_async_callback` puts its `dispose` in the same
reverse-ordered stack, the shape for any resource whose cleanup is a coroutine.
It also buys conditional and loop-built resources, plus `stack.pop_all()` to
hand live ones to a caller that closes them later. Two constraints:

- **Enter and exit the stack in the same task.** A `TaskGroup` reports a failing
  child against the task that entered it, so closing the stack from another task
  logs `Task ... has errored out but its parent task ... is already completed`
  and the cancellation never reaches the body.
- **A `TaskGroup` in the stack rewraps the body's exceptions**: a `RuntimeError`
  raised inside `async with build(...)` arrives as
  `ExceptionGroup(RuntimeError(...))`, so unwrap the group at the entrypoint
  (`concurrency.md`).

The test seam is a second root, not a patch: a `build_for_test` yielding the
same `App` with fakes makes every test enter the real lifecycle, rewrapping
included (`pytest.RaisesGroup`, not `pytest.raises`). Synchronous entrypoints
take the same shape with `contextlib.ExitStack` and `@contextmanager`, composing
handlers through a closure or `functools.partial` -
`App(allocate=partial(allocate, uow=uow))`, mindful that a `lambda` capturing a
loop variable binds late, leaving every composed handler holding the last value.
Reach for a DI framework only once dependencies have their own chained
dependencies; below that it trades a startup-visible wiring error for a
resolution-time one.

## Resource and transaction boundaries

A context manager is the syntactic carrier of a scope. Make the Unit of Work
safe by default: commit only on explicit success, roll back on any exit.

```python
class SqlAlchemyUnitOfWork:
    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory   # injected by the composition root

    def __enter__(self) -> Self:
        self.session = self._session_factory()
        return self

    def __exit__(self, *exc: object) -> None:
        self.session.rollback()   # no-op after an explicit commit; safe default
        self.session.close()

    def commit(self) -> None:
        self.session.commit()
```

The only path that persists is total success plus an explicit `commit()`; any
exception or early return leaves the default rollback in force, safe because a
committed session has nothing left to roll back.

## Retries live in the adapter

A retried pure function is a bug, not resilience: the core has nothing transient
to recover from, so a retry there hides non-determinism that should have been a
port. Retries belong in the adapter, under four rules.

- **Name the exception.** Retry a specific transient type, never bare
  `Exception`, which turns your own `TypeError` into a slow crash with the
  traceback buried in the last attempt.
- **Idempotency first.** Retry only an operation provably safe to repeat, or
  send an idempotency key so it becomes one (`architecture`'s
  `workflows-transactions.md`).
- **Exhaustion becomes a typed error.** `stamina` re-raises the last exception
  when attempts run out, so the adapter catches it there and returns a domain
  value the caller can branch on (`errors.md`), not a later transport exception.
- **The policy is a value, not a loop.** A hand-rolled `for _ in range(3)` ships
  without jitter, so clients retry in lockstep and turn a blip into a thundering
  herd, and without a total-time bound. Ladder: repo convention > `stamina` >
  `tenacity`.

```python
retry_transient = partial(stamina.retry, on=httpx.TransportError, attempts=5, timeout=30.0)

@dataclass(frozen=True, slots=True, kw_only=True)
class StripePayments:
    http: httpx.AsyncClient
    key: SecretStr

    async def charge(self, ref: Reference, amount: int) -> Result[ChargeId, PaymentUnavailable]:
        @retry_transient()
        async def _post() -> ChargeId:
            headers = {"Authorization": f"Bearer {self.key.get_secret_value()}",  # one unwrap
                       "Idempotency-Key": ref}    # safe to repeat, so safe to retry
            r = await self.http.post("/charges", json={"ref": ref, "amount": amount}, headers=headers)
            r.raise_for_status()
            return ChargeId(r.json()["id"])

        try:
            return Ok(await _post())
        except httpx.TransportError:
            return Err(PaymentUnavailable(reference=ref))   # exhaustion is a value
```

`stamina.retry` gives `on=` no default, so the bare-`Exception` version cannot
be written by omission; tenacity 9.1.4 defaults to `retry_if_exception_type()`
with `stop_never` and `reraise=False`, retrying a `TypeError` forever and, once
a `stop=` is added, hiding the original type behind `RetryError`. `stamina`'s
`timeout=` bounds total elapsed time independently of `attempts=` (defaults:
45s, 10 attempts); `stamina.set_active(False)` in an autouse fixture makes every
call a single attempt, so a suite's failure paths cost milliseconds.

## Inject the clock

Time is an input: a pure function takes `now` as an argument (`is_overdue(due,
now)`), dependency-bearing code takes a clock port, a test passes a value.
Reading the clock is one method, so `type Now = Callable[[], datetime]` is the
port the rule above asks for, with `datetime.now(tz=UTC)` as its adapter; a
named `Clock` Protocol earns its name once it also carries `monotonic` or
`sleep`. The argument form needs no fake and no patching, which matters because
asyncio has no virtual test clock that advances on demand, and neither does
anyio: `trio.testing.MockClock` is Python's only one.

`time-machine` is scoped to the shell: third-party code that reads the wall
clock itself, and characterisation tests around legacy code before the port is
extracted. Prefer it to `freezegun`, which rebinds `datetime.datetime` to its
own `FakeDatetime` in every already-imported module and returns the wall-clock
epoch from `time.monotonic()`, hanging timeout arithmetic (freezegun 1.5.5,
time-machine 3.5.0). A freeze-time import in the domain tests signals a missing
port. `mechanical-enforcement` gates the core half: ruff `DTZ` for naive
datetimes and `TID251` on `datetime.datetime.now`/`time.time`. The clock adapter
needs no exemption, for the same reason the settings module does not: it sits
outside the glob the ban is scoped to. The two are not one gate -
`datetime.now(tz=UTC)` raises no `DTZ` finding and is still an ambient clock
read, so only the ban removes it from the core.
