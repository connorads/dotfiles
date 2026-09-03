# Resources, scopes, and time

Cleanup, the transaction and retry boundaries, and the clock port - in an Effect repo,
`Scope` and `Schedule` from the vendored `effect` skill instead. `architecture` owns the
principles: `configuration-lifecycle.md` for the one composition root,
`workflows-transactions.md` for commit-only-on-total-success.

## `using`, `await using`, and `DisposableStack`

`using x = r` calls `r[Symbol.dispose]()` at block exit, `await using x = r` awaits
`r[Symbol.asyncDispose]()`, and release runs in reverse acquisition order on every path,
return or throw. `DisposableStack` and `AsyncDisposableStack` aggregate them: `.use(r)`
adopts a resource, `.defer(fn)` closes one with no dispose method, `.move()` hands
ownership out. Three traps, verified 2026-09-03 on tsc 7.0.2 and node 24.19.0:

- **The lib.** `Disposable`, `AsyncDisposable` and `DisposableStack` are absent from
  `lib: ["es2025"]`: `TS2318: Cannot find global type 'Disposable'`, plus `TS2304` on
  `DisposableStack` and `TS2550: Property 'dispose' does not exist on type
  'SymbolConstructor'`. Name `esnext.disposable`; a node project appears to work without
  it only because `@types/node/index.d.ts:29` carries `/// <reference
  lib="esnext.disposable" />`, so dropping `types: ["node"]` loses them silently
  (`toolchain.md`, "The lib ceiling").
- **`noUnusedLocals` fires on the canonical shape.** `using span = tracer.start()` is
  held for its side effect alone, so it is `TS6133: 'span' is declared but its value is
  never read`, pointing at the variable, so it reads as "delete the line". `using _span`
  is exempt; the leading underscore does not exempt `const _dead`.
- **A throwing disposer replaces the body's error** with a `SuppressedError` whose
  `.error` is the disposer's failure and `.suppressed` the original.

## The composition root is a scope

Wire adapters in one root over an `AsyncDisposableStack`: acquisition order is code
order, release its exact reverse, whether `build` returns or throws. Ownership leaves
through an **eager** `stack.move()` captured in a variable.

```ts
export async function build(url: string): Promise<{ app: App } & AsyncDisposable> {
  await using stack = new AsyncDisposableStack();
  const pool = await openPool(url);
  stack.defer(() => pool.end());
  const moved = stack.move(); // eager: ownership leaves the scope here
  return { app: makeApp(pool), [Symbol.asyncDispose]: () => moved.disposeAsync() };
}
```

The lazy `[Symbol.asyncDispose]: () => stack.move().disposeAsync()` type-checks at exit
0 and is a use-after-dispose: `await using` disposes the stack at `build`'s return, so
the pool closes before the caller queries it and the disposer throws `ReferenceError:
Cannot call AsyncDisposableStack.prototype.move on an already-disposed DisposableStack`.
Config parsing at this boundary: `modules.md`.

## The transaction boundary is a closure

A transaction is a scope over a callback and `tx` never escapes it; a returned `tx` runs
after rollback. `await using` cannot carry it alone, because a disposer learns nothing
about how the body exited.

```ts
export async function withTransaction<T>(pool: Pool, work: (tx: Tx) => Promise<T>): Promise<T> {
  const h = await pool.begin();
  let commitAttempted = false;
  try {
    const out = await work(h.tx);
    commitAttempted = true; // set BEFORE commit: a failed commit must not roll back
    await h.commit();
    return out;
  } catch (error) {
    if (!commitAttempted) try { await h.rollback(); }
    catch (e) { throw new SuppressedError(e, error, "rollback failed"); }
    throw error;
  } finally { h.release(); } // the connection returns to the pool on every path
}
```

Each guard repairs a defect of the naive `try { commit } catch { rollback; throw e }`,
all three reproduced on node 24.19.0: a bare `await h.rollback()` lets the rollback
rejection pre-empt the `throw`, so a dead connection hands the caller `ECONNRESET`
instead of `InsufficientFunds`; no `finally` leaks a connection per call; and a commit
that throws rolls back a transaction the driver has finished. An `err` returned from
`work` is a normal return, so it **commits**: a rejection that must not persist throws
inside the module, or gets a Result-aware twin. Say which.

## Retries are a named policy value

A retry belongs to the adapter owning the connection, never to the pure core, and it is
a value rather than a loop: `for (let i = 0; i < 3; i++)` ships with no jitter (so
clients retry in lockstep, turning a blip into a herd), no total-time bound, and a
catch-all that turns a `TypeError` into a slow crash.

```ts
import { setTimeout as sleep } from "node:timers/promises";
type Policy = { attempts: number; baseMs: number; totalMs: number }; // transient, aggressive...
type Fail = { _tag: "RetriesExhausted"; attempts: number } | { _tag: "Cancelled" };
type Retried<T> = { ok: true; value: T } | { ok: false; error: Fail };

export async function withRetry<T>(policy: Policy, isTransient: (e: unknown) => boolean,
  signal: AbortSignal, op: (s: AbortSignal) => Promise<T>): Promise<Retried<T>> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(policy.totalMs)]);
  const spent = (n: number): Retried<T> => signal.aborted
    ? { ok: false, error: { _tag: "Cancelled" } }
    : { ok: false, error: { _tag: "RetriesExhausted", attempts: n } };
  for (let n = 0; n < policy.attempts; n++) {
    if (deadline.aborted) return spent(n); // a pre-aborted caller never reaches op
    try { return { ok: true, value: await op(deadline) }; }
    catch (e) {
      if (!isTransient(e)) throw e; // a defect is not retried
      if (n === policy.attempts - 1) break; // no sleep after the last attempt
      const b = policy.baseMs * 2 ** n; // exponential
      try { await sleep(b / 2 + Math.random() * b, undefined, { signal: deadline }); } // jitter
      catch { return spent(n + 1); } // budget expiry is a value, not an AbortError
    }
  }
  return spent(policy.attempts);
}
```

Name `isTransient`: a catch-all turns a defect into a domain value the caller reads as
an outage. Sleeping on `{ signal: deadline }` rejects with an `AbortError`
byte-identical to the caller's own cancellation, so catching it and splitting on
`signal.aborted` is what makes exhaustion and cancellation branchable values rather than
one opaque throw; declare the return type, or `_tag` widens to `string` (`errors.md`).
`AbortSignal.any` returns an already-aborted signal, so without the top-of-loop check a
cancelled request still charges the card once. `Math.random` for jitter is correct in an
adapter and banned in the core by the purity glob it sits outside
(`mechanical-enforcement`); node 24.19.0 has no global `scheduler`, so sleep comes from
`node:timers/promises`. Retry only what is idempotent (`architecture`,
`workflows-transactions.md`); versions are `toolchain.md`, "Library facts"; cancellation
is `concurrency.md`.

## Inject the clock

Time is an input: a pure function takes `now` as an argument (`isOverdue(dueAt: number,
now: number)`), dependency-bearing code takes the one-method port `type Now = () =>
number` (epoch ms), a test passes a number. `export const systemNow: Now = () =>
Date.now()` is the one sanctioned `Date.now`, in the shell and in a different file from
the pure core, because the purity ban is scoped by path.

Temporal (the date API, not the durable-execution engine) is typed ahead of the runtime:
`Temporal.Instant` needs `lib: [..., "esnext.temporal"]` or the namespace is `TS2503:
Cannot find namespace 'Temporal'`, and with that lib the same code compiles at exit 0
while `typeof Temporal` is `undefined` on node 24.19.0 and bun 1.3.14. Node 26 ships it
unflagged and reaches Active LTS on 2026-10-28, the floor for a domain type. The port
earns its keep past that date: vitest 4.1.11 bundles `@sinonjs/fake-timers` 15.0.0,
whose shipped code holds zero occurrences of `Temporal`, so `vi.useFakeTimers()` freezes
`Date.now()` and leaves `Temporal.Now` on the wall clock, silently.
