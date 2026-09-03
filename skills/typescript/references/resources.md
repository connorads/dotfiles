# Resources, scopes, and time

Cleanup, transaction and retry boundaries, and the clock port. Effect repos use the vendored `effect` skill. Architecture principles live in `configuration-lifecycle.md` and `workflows-transactions.md`.

## `using`, `await using`, and `DisposableStack`

`using x = r` calls `r[Symbol.dispose]()` at block exit, `await using x = r` awaits `r[Symbol.asyncDispose]()`, and release runs in reverse acquisition order on every path, return or throw. `DisposableStack` and `AsyncDisposableStack` aggregate them; `.move()`
hands ownership out. Three traps:

- **The lib.** `Disposable`, `AsyncDisposable` and `DisposableStack` are absent from
  `lib: ["es2025"]`: `TS2318: Cannot find global type 'Disposable'`, plus `TS2304` on
  `DisposableStack` and `TS2550: Property 'dispose' does not exist on type
  'SymbolConstructor'`. Name `esnext.disposable`; see `toolchain.md`, The lib ceiling.
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
  const app = makeApp(pool); // construction can throw while stack still owns pool
  const moved = stack.move();
  return { app, [Symbol.asyncDispose]: () => moved.disposeAsync() };
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
import { err, type Result } from "./result.js";
type TxFailure<E> =
  | { readonly _tag: "TransactionBeginFailed"; readonly cause: unknown }
  | { readonly _tag: "TransactionCommitFailed"; readonly cause: unknown }
  | { readonly _tag: "TransactionRollbackFailed"; readonly cause: unknown; readonly original: E };

export async function withTransaction<T, E>(pool: Pool,
  work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E | TxFailure<E>>> {
  let h: Handle;
  try { h = await pool.begin(); }
  catch (cause) { return err({ _tag: "TransactionBeginFailed", cause }); }
  try {
    const out = await work(h.tx);
    if (!out.ok) {
      try { await h.rollback(); return out; }
      catch (cause) { return err({ _tag: "TransactionRollbackFailed", cause, original: out.error }); }
    }
    try { await h.commit(); return out; }
    catch (cause) { return err({ _tag: "TransactionCommitFailed", cause }); }
  } catch (defect) {
    try { await h.rollback(); }
    catch (cause) { throw new SuppressedError(cause, defect, "rollback failed after defect"); }
    throw defect;
  } finally { h.release(); } // the connection returns to the pool on every path
}
```

An expected `err` rolls back and stays in the caller's error union. Infrastructure
failures gain stable tags; rollback failure also retains the original work error.
A thrown defect is rolled back and rethrown, with `SuppressedError` preserving both
failures. A failed commit never rolls back a transaction the driver may have finished.

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
      if (deadline.aborted) return spent(n + 1);
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

Name `isTransient`: a catch-all turns a defect into an outage. The total-time bound is
cooperative: every adapter must honour the supplied signal. Racing a deaf operation only
abandons it while it continues mutating state. Split deadline expiry from caller
cancellation through `signal.aborted`; see `errors.md`, Result shape.
`AbortSignal.any` returns an already-aborted signal, so without the top-of-loop check a
cancelled request still charges the card once. `Math.random` for jitter is correct in an
adapter and banned in the core by the purity glob it sits outside
(`mechanical-enforcement`). Sleep comes from `node:timers/promises`. Retry only what is
idempotent (`architecture`, `workflows-transactions.md`); cancellation
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
while `typeof Temporal` is `undefined` on the current runtime floor. The next runtime line ships it
unflagged and reaches Active LTS on 2026-10-28, the floor for a domain type. The port
earns its keep past that date: the current runner bundles fake timers,
whose shipped code holds zero occurrences of `Temporal`, so `vi.useFakeTimers()` freezes
`Date.now()` and leaves `Temporal.Now` on the wall clock, silently.
