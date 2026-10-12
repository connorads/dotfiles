// The controller end to end through fakes: a clock that only moves when told,
// a lib whose pidfile is one variable, and a thread count the test sets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentsController } from './agents-controller.ts';
import { GRACE_MS, LEASE, POLL_MS } from './agents.ts';
import type { LibStatus, Secs } from './domain.ts';
import type { CaffeineLib, Clock, ThreadStatusSource } from './ports.ts';

function fakes() {
  let now = 1_000_000;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const clock: Clock = {
    now: () => now,
    after: (ms, fn) => { const id = nextId++; timers.push({ at: now + ms, fn, id }); return () => { timers = timers.filter(t => t.id !== id); }; },
  };
  /** The pidfile: the lib reads and guards on this alone. */
  let lib: LibStatus = { kind: 'off' };
  let stopFails = false;
  const calls: string[] = [];
  const caffeine: CaffeineLib = {
    startOwned: async (secs: Secs) => {
      calls.push(`startOwned ${secs}`);
      lib = { kind: 'on', lid: false, pid: 100, deadline: now + secs * 1000, startedAt: now, owner: 'bb-agents' };
      return { ok: true };
    },
    renewOwned: async (secs: Secs) => {
      calls.push(`renewOwned ${secs}`);
      if (lib.kind !== 'on' || lib.owner !== 'bb-agents') return 'not-owned';
      lib = { ...lib, deadline: now + secs * 1000, startedAt: now };
      return 'renewed';
    },
    stopOwned: async () => {
      calls.push('stopOwned');
      if (stopFails) throw new Error('host timed out');
      if (lib.kind !== 'on' || lib.owner !== 'bb-agents') return 'not-owned';
      lib = { kind: 'off' };
      return 'stopped';
    },
  };
  let busy = 0;
  let changed: () => void = () => {};
  const threads: ThreadStatusSource = { busy: async () => busy, onChange: fn => { changed = fn; } };
  const logs: string[] = [];
  const controller = createAgentsController({ lib: caffeine, clock, threads, onChange: () => {}, log: line => logs.push(line) });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  return {
    controller, calls, logs,
    get lib() { return lib; },
    /** Someone else rewrote the pidfile, as a tmux start does. */
    set lib(next: LibStatus) { lib = next; },
    setBusy: (n: number) => { busy = n; },
    failStops: () => { stopFails = true; },
    threadsChanged: async () => { changed(); await settle(); },
    /** Move the clock, firing due timers in order, as the real event loop would. */
    advance: async (ms: number) => {
      const end = now + ms;
      for (;;) {
        const due = timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter(t => t !== due);
        now = due.at;
        due.fn();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

test('arm, run, go idle, and stop 5 minutes later', async () => {
  const f = fakes();
  f.setBusy(1);
  assert.deepEqual(await f.controller.arm(), { ok: true });
  assert.deepEqual(f.controller.state, { phase: 'holding', busy: 1 });
  assert.deepEqual(f.calls, [`startOwned ${LEASE}`]);

  f.setBusy(0);
  await f.threadsChanged();
  assert.equal(f.controller.state.phase, 'grace');
  await f.advance(GRACE_MS - 1_000);
  assert.equal(f.lib.kind, 'on');
  await f.advance(1_000);
  assert.deepEqual(f.calls, [`startOwned ${LEASE}`, 'stopOwned']);
  assert.equal(f.lib.kind, 'off');
  assert.deepEqual(f.controller.state, { phase: 'idle' });
  // One-shot: nothing polls once it has stopped.
  await f.advance(10 * POLL_MS);
  assert.equal(f.calls.length, 2);
});

test('a thread starting during grace keeps the Mac awake', async () => {
  const f = fakes();
  await f.controller.arm();
  assert.equal(f.controller.state.phase, 'grace');
  await f.advance(GRACE_MS / 2);
  f.setBusy(1);
  await f.threadsChanged();
  await f.advance(GRACE_MS);
  assert.deepEqual(f.controller.state, { phase: 'holding', busy: 1 });
  assert.equal(f.lib.kind, 'on');
});

test('a long run renews the lease before it runs out', async () => {
  const f = fakes();
  f.setBusy(1);
  await f.controller.arm();
  await f.advance(31 * 60_000);
  assert.ok(f.calls.includes(`renewOwned ${LEASE}`));
  const lib = f.lib as Extract<LibStatus, { kind: 'on' }>;
  assert.ok(lib.deadline! - (1_000_000 + 31 * 60_000) > 30 * 60_000);
});

test('a manual tmux start during grace is never stopped', async () => {
  const f = fakes();
  await f.controller.arm();
  const manual: LibStatus = { kind: 'on', lid: false, pid: 200, deadline: null, startedAt: 0, owner: null };
  f.lib = manual;
  await f.controller.observe(manual);
  assert.deepEqual(f.controller.state, { phase: 'idle' });
  await f.advance(GRACE_MS * 2);
  assert.deepEqual(f.calls, [`startOwned ${LEASE}`]);
  assert.equal(f.lib, manual);
});

test('a manual start the controller has not yet seen is protected by the guarded stop', async () => {
  const f = fakes();
  await f.controller.arm();
  const manual: LibStatus = { kind: 'on', lid: false, pid: 200, deadline: null, startedAt: 0, owner: null };
  f.lib = manual;
  await f.advance(GRACE_MS);
  assert.deepEqual(f.calls, [`startOwned ${LEASE}`, 'stopOwned']);
  assert.equal(f.lib, manual);
  assert.deepEqual(f.controller.state, { phase: 'idle' });
});

test('a restarted server adopts an owned session mid-grace and runs a fresh grace', async () => {
  const before = fakes();
  await before.controller.arm();
  await before.advance(3 * 60_000);
  before.controller.dispose();

  const after = fakes();
  after.lib = before.lib;
  await after.controller.observe(after.lib);
  assert.equal(after.controller.state.phase, 'grace');
  await after.advance(GRACE_MS - 1_000);
  assert.equal(after.lib.kind, 'on');
  await after.advance(1_000);
  assert.deepEqual(after.calls, ['stopOwned']);
  assert.equal(after.lib.kind, 'off');
});

test('user off stops an owned session at once', async () => {
  const f = fakes();
  f.setBusy(2);
  await f.controller.arm();
  assert.deepEqual(await f.controller.off(), { ok: true });
  assert.equal(f.lib.kind, 'off');
  assert.deepEqual(f.controller.state, { phase: 'idle' });
});

test('user off reports a stop that failed or found the session taken over', async () => {
  const failed = fakes();
  failed.setBusy(1);
  await failed.controller.arm();
  failed.failStops();
  const result = await failed.controller.off();
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /host timed out/);
  assert.equal(failed.lib.kind, 'on');

  const taken = fakes();
  taken.setBusy(1);
  await taken.controller.arm();
  taken.lib = { kind: 'on', lid: false, pid: 200, deadline: null, startedAt: 0, owner: null };
  assert.equal((await taken.controller.off()).ok, false);
  assert.equal(taken.lib.kind, 'on');
});

test('inputs that arrive together stay in order', async () => {
  const f = fakes();
  f.setBusy(1);
  const results = await Promise.all([f.controller.arm(), f.controller.arm()]);
  assert.deepEqual(results[0], { ok: true });
  assert.equal(results[1].ok, false);
  assert.deepEqual(f.calls, [`startOwned ${LEASE}`]);
  const owned = f.lib;
  await Promise.all([f.controller.observe(owned), f.controller.off(), f.controller.observe(owned)]);
  // The stale owned status queued after the stop must not resurrect it: the stop already made the pidfile OFF.
  assert.deepEqual(f.calls, [`startOwned ${LEASE}`, 'stopOwned']);
});
