# Concurrency: cancellation, ownership, back-pressure

Concurrency belongs to the imperative shell (`architecture`, Functional Core, Imperative Shell); the pure core has nothing to await, and JavaScript has no task group, so ownership is something the code builds. Every runtime claim below is
verified 2026-09-03 against the floors in `toolchain.md`.

## Cancellation is a parameter

A deadline is unenforceable unless the port type carries the signal: a caller that
stops awaiting does not stop the work, so the socket, the transaction and the
memory stay alive. Put it in the type and thread it through every adapter.

```ts
export type Fetch = (url: string, opts: { readonly signal: AbortSignal }) => Promise<Response>;
export async function withDeadline<T>(ms: number, parent: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const deadline = AbortSignal.timeout(ms);
  return await run(parent ? AbortSignal.any([parent, deadline]) : deadline); // any: node >= 20.3 || >= 18.17
}
/** A deadline aborts with TimeoutError, a controller with AbortError: accept both. */
export const isCancelled = (e: unknown): boolean =>
  e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError");
```

| Fact | Consequence |
| --- | --- |
| `AbortSignal.timeout` aborts with a **TimeoutError** `DOMException`, `abort()` with an **AbortError** one, `abort(reason)` with that reason verbatim | a predicate matching only `AbortError` is false for every deadline `withDeadline` itself produces |
| `DOMException` is an `Error` subclass | `e instanceof Error` does not discriminate it; translate it at the shell like any boundary exception (`errors.md`, Translation at the shell) |
| The timeout does not hold the event loop open: a listener-only script exits before it fires on node and bun | work that must outlive its own timer holds the loop itself; an unsettled top-level await exits 13 on node, while bun stays alive until the timeout fires |
| `const f: Fetch = async (url) => fetch(url)` is assignable under parameter bivariance, exit 0 | the signal is offered, never imposed, and tsc cannot see a dropped one |

## Promise combinators are not a task group

`Promise.all` marks every input handled at call time. The first rejection is what
the caller sees; a sibling failing afterwards is swallowed with no
`unhandledRejection` and exit 0, it keeps running either way, and only the first
error survives - `Promise.all` never produces an `AggregateError`. The one path it
does not cover is a synchronous throw while the array is evaluated:
`Promise.all([slow(), throwsSync()])` never reaches the combinator, `slow()` is
left with no handler, and node and bun both exit 1. `Promise.allSettled` never
rejects, so awaiting it without reading `status === "rejected"` is the JS spelling
of a swallowed error; it is the accumulate half of `errors.md`, Fail fast, or
accumulate. `Promise.any` keeps every failure, on `AggregateError.errors`.

## A scope owns every task it spawns

Three rules: every task has an owner, the first failure aborts its siblings, the
owner awaits them all before returning. Used as `await using scope = new
TaskScope()`, then `scope.spawn(charge)`. Two properties a `TaskGroup`-shaped API
cannot have here - a signal is offered rather than imposed, so a child that never
reads it runs to completion (a 300ms deaf sibling delays the scope by 300ms), and
cancel-and-walk-away is not cancel-and-join unless the scope joins.

```ts
type Outcome = { readonly failed: boolean; readonly reason: unknown };
export class TaskScope implements AsyncDisposable {
  readonly #ac = new AbortController();
  readonly #tasks: Promise<Outcome>[] = [];
  get signal(): AbortSignal { return this.#ac.signal; }
  /** The handler is attached here, not in dispose: an unhandled window is fatal. */
  spawn<T>(fn: (signal: AbortSignal) => Promise<T>): void {
    this.#tasks.push(
      Promise.resolve().then(() => fn(this.#ac.signal)).then(
        (): Outcome => ({ failed: false, reason: undefined }),
        (reason: unknown): Outcome => {
          const echo = this.#ac.signal.aborted && (reason === this.#ac.signal.reason ||
            (reason instanceof Error && (reason.name === "AbortError" || reason.name === "TimeoutError") &&
              reason.cause === this.#ac.signal.reason));
          this.#ac.abort(reason);
          return { failed: !echo, reason }; // the failure travels on as a value
        },
      ),
    );
  }
  async [Symbol.asyncDispose](): Promise<void> {
    const errors = (await Promise.all(this.#tasks)).flatMap((o) => (o.failed ? [o.reason] : []));
    if (errors.length > 0) throw new AggregateError(errors, "task scope failed");
  }
}
```

| Fact | Consequence |
| --- | --- |
| The shorter `fn(sig).catch((e) => { abort(e); throw e; })` form stores a rejected promise nothing handles until dispose, and a child failing while the scope body still runs exits 1 on node and bun | attach the handler at spawn: the form above exits 0, reports `AggregateError: task scope failed` carrying the child's error, and returns ~50ms into a 300ms cooperative sibling |
| A cooperative sibling may reject with `signal.reason` or a native cancellation error whose `cause` is that reason | the `echo` test removes those duplicates; an independent failure remains in the `AggregateError` |
| `#private` fields are erasable where constructor parameter properties are not (`modeling.md`) | the scope compiles under `erasableSyntaxOnly`; `await using` needs the disposable lib and a disposer that can itself throw (`resources.md`) |

## Bounded fan-out

`await Promise.all(rows.map(importOne))` sets concurrency to the length of the
input. Workers sharing one iterator cap in-flight work instead. The limit belongs
to the adapter owning the resource: a limiter created inside the function it
limits limits nothing.

```ts
export async function mapLimit<A, B>(items: Iterable<A>, limit: number, signal: AbortSignal, fn: (a: A, index: number, signal: AbortSignal) => Promise<B>): Promise<B[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`mapLimit: limit must be a positive integer, got ${String(limit)}`);
  const queue = [...items].entries(); // one shared iterator; next() is synchronous
  const out: B[] = [];
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) {
      signal.throwIfAborted(); // stop draining once the owner has given up
      out[index] = await fn(item, index, signal);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}
```

| Fact | Consequence |
| --- | --- |
| `Math.max(1, NaN)` is `NaN`, `Array.from({ length: NaN })` is empty and `Promise.all([])` resolves, and `Number(process.env["CONCURRENCY"])` on an unset variable is `NaN` | the clamped form processes zero rows and returns `[]` at exit 0, so refuse a non-finite limit instead. A bad limit is a defect, so it throws (`errors.md`, Panic helpers - the defect vocabulary) |
| Without the signal, surviving workers empty the queue behind a caller that has already rejected: 7 rows started at the rejection, all 20 started 80ms later | spawn the fan-out inside a scope - `scope.spawn((signal) => mapLimit(rows, 4, signal, importOne))` - and the first failure stops it at 7 |

## Back-pressure is the return type

A port returning `Promise<T[]>` has bought the whole result set already;
`AsyncIterable<T>` gives the consumer the pace, and the `await` inside
`for await` **is** the back-pressure.

```ts
export type OrderFeed = { stream(signal: AbortSignal): AsyncIterable<string> };
type Handle = (order: string, signal: AbortSignal) => Promise<void>;

export async function drain(feed: OrderFeed, handle: Handle, signal: AbortSignal): Promise<void> {
  for await (const order of feed.stream(signal)) await handle(order, signal); // await = back-pressure
}
```

| Fact | Consequence |
| --- | --- |
| `break` calls `.return()` on the iterator; an async generator implements it and runs its `finally`, a hand-rolled `{ next }` object does not | only a generator guarantees cleanup, so write the adapter as `async function*` |
| A web stream's default queuing strategy is a high-water mark of 1, and stages compose additively - a source piped through a default `TransformStream` with nothing reading holds 2 chunks | the stream bounds itself where an array buffer does not, but the bound is per stage |
| Both `pipeTo` and `pipeThrough` take `{ signal }` and reject with the abort reason | `pipeThrough` returns the transformed stream, so its failure surfaces only on the readable side |

## The entrypoint owns the process

The entrypoint is the only file that touches process-level concerns - fatal
handlers, signals, exit codes.

```ts
export function installProcessHandlers(drain: (signal: AbortSignal) => Promise<void>, graceMs = 10_000): AbortSignal {
  process.on("unhandledRejection", (reason: unknown) => {
    // Installing any listener removes node's default fatal; the rethrow restores it.
    throw reason instanceof Error ? reason : new Error(`unhandled rejection: ${String(reason)}`);
  });
  const shutdown = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      // A signal listener removes the default terminate, so this path must exit itself.
      shutdown.abort(new Error(sig));
      setTimeout(() => process.exit(1), graceMs).unref(); // the orchestrator's grace period
      void drain(shutdown.signal).then(() => process.exit(0), () => process.exit(1));
    });
  }
  return shutdown.signal;
}
```

| Fact | Consequence |
| --- | --- |
| An unhandled rejection is fatal by default (exit 1 on node and bun), and a handler that logs and returns drops the same script to exit 0 | the rethrow is what keeps it fatal, and it holds under a deploy-set `--unhandled-rejections=warn`, where the bare script exits 0 and this one exits 1 |
| `--unhandled-rejections=strict` exits 1 even with a swallowing handler, on both runtimes | it is the belt-and-braces flag for a process whose handlers you do not own |
| A non-`Error` rejection reason prints no stack at all | wrap it before rethrowing, or lose the site |
| A SIGTERM listener removes the default terminate | a handler that only aborts leaves the process alive through the grace period and dies by SIGKILL (measured still-alive on node and bun, against exit 0 for the form above) |

The lint half - floating and misused promises - is advisory, in
`mechanical-enforcement`. Nothing in tsc sees an unowned task.

## What belongs elsewhere

- `await using`, `DisposableStack`, retry policy, the clock port: `resources.md`.
- `DOMException` and `AggregateError` translation: `errors.md`, Translation at the
  shell. Idempotency, sagas, durable execution: `architecture`.
- Fibers, `Schedule`, `Stream`, concurrency inside Effect: the vendored `effect`
  skill (`skl effect`).
