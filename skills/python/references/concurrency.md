# The async shell

Concurrency lives in the imperative shell: the pure core has nothing to await,
and `async` on it spreads the colour through every caller for no gain.

## Every task has an owner

Spawn only inside a scope that owns the task: `asyncio.TaskGroup` (3.11+) or
`anyio.create_task_group()`. The group awaits every child before its `async with`
exits, and a failing child cancels its siblings.

A bare `asyncio.create_task(...)` whose result nobody stores loses three things:

- **The task.** The loop keeps only weak references, so an unreferenced task "may
  get garbage collected at any time, even before it's done" (CPython docs).
- **The failure.** Nobody awaits it, so the exception is never raised: a
  `Task exception was never retrieved` line on stderr, and the process exits 0.
- **Shutdown.** Nothing cancels it, so the work is cut mid-flight at loop close.

Long-lived background work belongs to a `TaskGroup` entered in the composition
root's scope, handed to the app as a `spawn` callable (`ports-persistence.md`).
Never start one at import: `import` executes the file, so a module-level
supervisor binds a running loop to import order (`modules.md`).

ruff `RUF006` fires on an `asyncio.create_task(...)` or `ensure_future(...)`
result that is discarded, or bound to a name the function never reads again.
Awaiting it, or holding it in a collection or on an attribute, passes - as does
`tg.create_task(...)`, which is not the module-level function the rule inspects.

## Failures arrive as groups

A child failure inside a task group arrives wrapped in an `ExceptionGroup` **even
when exactly one child failed**, so moving working code inside a group silently
stops `except OutOfStock:` matching and the error escapes as an unhandled group.

`except*` selects the leaf types it names, runs once per matching subgroup, and
re-raises the rest. It cannot end the function it is in - `return`, `break` and
`continue` inside it are a `SyntaxError` - so it handles in place, and
`except ExceptionGroup` plus `ExceptionGroup.split` turns a group into a value:

```python
async def place_order(
    order: Order, payments: Payments, inventory: Inventory
) -> Result[OrderPlaced, OrderRejected]:
    try:
        async with asyncio.TaskGroup() as tg:      # a failing child cancels its siblings
            _ = tg.create_task(payments.charge(order))
            _ = tg.create_task(inventory.reserve(order))
    except ExceptionGroup as eg:                   # `except OutOfStock` would not match
        expected, unexpected = eg.split((OutOfStock, PaymentDeclined))
        if unexpected is not None:
            raise unexpected                       # a defect is not an outcome
        if expected is None:
            raise
        return Err(OrderRejected(tuple(expected.exceptions)))
    return Ok(OrderPlaced(order))
```

Unwrap once, at the shell, and translate the leaves into domain errors there
(`errors.md`); the core should never learn that two adapters ran concurrently.

`except ExceptionGroup` is the narrow catch on purpose: a group carrying a
`BaseException` child is a `BaseExceptionGroup`, which it does not match, so a
`KeyboardInterrupt` in a child still leaves through the handler.

Assert with `pytest.RaisesGroup` where a group is the contract, plain
`pytest.raises` where the shell must have unwrapped: a forgotten unwrap leaves a
group, which `RaisesGroup` passes and `pytest.raises` fails on (`conventions.md`).

## Cancellation is a request

`asyncio.CancelledError` derives from `BaseException`, not `Exception`, so
`except Exception` is safe by construction and bare `except:` and
`contextlib.suppress(BaseException)` are the two ways to break cancellation.
Swallowing it turns `cancel()` into a no-op: the task completes with a value and
the caller is told it finished. Catch it only to clean up, then re-raise.

Deadlines are `asyncio.timeout`, which cancels the body and raises the builtin
`TimeoutError`:

```python
async with asyncio.timeout(settings.request_timeout):
    reply = await client.post(url, json=payload)
```

- **A deadline is not a guarantee.** Cancellation unwinds through every
  `finally`, and a `finally` that awaits extends the wait: a 0.1s timeout over a
  task whose cleanup sleeps 0.5s exits at 0.6s. Bound cleanup with its own timeout.
- **`asyncio.shield` protects cleanup, nothing else.** `cancel()` delivers
  `CancelledError` once, so an awaiting `finally` completes unaided;
  `await asyncio.shield(session.close())` in it saves that cleanup when a *second*
  cancellation lands. Shielding ordinary work leaves it unowned again.

## Nothing blocks the loop

One blocking call stalls every task on the loop: a 0.3s `time.sleep` stops a
10ms ticker sharing it for the whole 0.3s; `asyncio.to_thread` costs it nothing.

- **Blocking I/O**: `await asyncio.to_thread(render_pdf, order)`, the answer for
  a sync SDK with no async twin.
- **CPU-bound work**: a `ProcessPoolExecutor`, or an `InterpreterPoolExecutor`
  (3.14), via `loop.run_in_executor(pool, fn, *args)`. Both want a module-level
  function and arguments that cross the boundary: a closure is a `PicklingError`
  on the process pool, a `NotShareableError` on the interpreter pool.
- **Waiting for a condition**: an `asyncio.Event`, never a `while not ready:
  await asyncio.sleep(0.1)` poll loop, which burns wakeups and adds up to its own
  interval of latency.

ruff `ASYNC210` (blocking HTTP call) and `ASYNC251` (`time.sleep`) gate the first
two by default; `ASYNC110` (busy-wait) needs the `ASYNC` family selected, so a
project on the defaults has no gate on the poll loop (`mechanical-enforcement`
owns the selection). The family inspects `async def` bodies only, so a blocking
sync helper is invisible to it. The runtime backstop is asyncio debug mode:
`asyncio.run(main(), debug=True)` or `PYTHONASYNCIODEBUG=1` logs `Executing
<Task ...> took 0.305 seconds` for a callback over `loop.slow_callback_duration`
(0.1s by default). Turn it on for the test suite, where the call is attributable.

Caching is the other way blocking creeps back in. `functools.lru_cache` on an
`async def` caches the **coroutine object**, not the value, so the second hit
awaits a consumed one: `RuntimeError: cannot reuse already awaited coroutine`.

```python
@lru_cache(maxsize=64)                 # wrong: caches the coroutine, not the rate
async def rate(pair: str) -> float: ...
```

Cache the awaited value instead, in a bounded cache owned by the composition root
that dedupes concurrent misses on the same key and never stores a failure.

## Streams and back-pressure

A port whose method returns `AsyncIterator[T]` hands the consumer control of the
pace; one that returns `list[T]` has already bought the whole result. The return
type is where back-pressure and cancellation live, so choose it before a queue.

Where producer and consumer must decouple, a bounded `asyncio.Queue(maxsize=n)`
is the coupling: `put` blocks while full, the signal a fast producer needs. An
unbounded queue hides back-pressure as memory growth until the process dies.

`Queue.shutdown()` (3.13+) makes the poison-pill sentinel unnecessary, and a
project at the 3.12 floor still needs that sentinel. It wakes every waiting
`get()` with `asyncio.QueueShutDown`, so consumers exit on a real exception
instead of on a magic value typed into the queue's element type:

```python
async def drain(q: asyncio.Queue[Order], handle: Handler) -> None:
    while True:
        try:
            order = await q.get()
        except asyncio.QueueShutDown:      # the producer called q.shutdown()
            return
        try:
            await handle(order)
        finally:
            q.task_done()
```

Fan-out is bounded by a semaphore, not by the length of the input. The task group
still owns every task, so one failure cancels the rest and the group raises:

```python
async def fetch_all(urls: Sequence[str], fetch: Fetch, limit: int = 10) -> tuple[bytes, ...]:
    sem = asyncio.Semaphore(limit)

    async def one(url: str) -> bytes:
        async with sem:
            return await fetch(url)

    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(one(u)) for u in urls]
    return tuple(t.result() for t in tasks)
```

## What belongs elsewhere

- Durable execution, sagas, compensating actions, idempotency keys: `architecture`.
- The composition root as a scope, the `Clock` port, adapter retry policy:
  `ports-persistence.md`.
- ruff and pytest configuration, `ASYNC` selection: `mechanical-enforcement`.
- Async test mechanics and `pytest.RaisesGroup`: `conventions.md`, `testing`.
