import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionResult } from './domain.ts';
import { act, ACTION_TIMEOUT_MS, close, refresh, setClient, snapshot, toggle, type Rpc } from '../store.ts';

// The store reads state on every open; these tests only care about actions.
setClient({ call: async () => ({ kind: 'off' }) } as unknown as Rpc);
const chip = { getBoundingClientRect: () => ({ top: 0, right: 40, bottom: 28, left: 0 }) } as HTMLElement;
const label = { doing: 'Extending', failed: 'Extend' };
const ok: ActionResult = { ok: true };
const refused: ActionResult = { ok: false, reason: 'Nothing is running to extend.', stoppedPrevious: false };

// A failed test must not leave a popover open for the next one to toggle shut.
afterEach(() => close());

function deferred() {
  let settle!: (result: ActionResult | Error) => void;
  const promise = new Promise<ActionResult>((resolve, reject) => {
    settle = result => result instanceof Error ? reject(result) : resolve(result);
  });
  return { call: () => promise, settle };
}

test('one action at a time, even across close and reopen', async () => {
  const first = deferred();
  toggle('pointer', chip);
  const running = act(label, first.call);
  close();
  toggle('pointer', chip);
  assert.deepEqual(snapshot().pending, label, 'a reopened popover sees the action still running');
  let calls = 0;
  assert.equal(await act(label, async () => { calls += 1; return ok; }), false);
  assert.equal(calls, 0);
  first.settle(ok);
  assert.equal(await running, true);
  assert.equal(snapshot().pending, null);
  close();
});

test('success closes the popover it came from, and leaves one opened since alone', async () => {
  const same = deferred();
  toggle('keyboard', chip);
  const done = act(label, same.call);
  same.settle(ok);
  await done;
  assert.equal(snapshot().open, null);

  const late = deferred();
  toggle('pointer', chip);
  const running = act(label, late.call);
  close();
  toggle('pointer', chip);
  late.settle(ok);
  await running;
  assert.notEqual(snapshot().open, null, 'the reopened popover stays open');
  close();
});

test('a failure shows in the popover open at the time, and goes when it closes', async () => {
  const failing = deferred();
  toggle('pointer', chip);
  const running = act(label, failing.call);
  close();
  toggle('pointer', chip);
  failing.settle(refused);
  assert.equal(await running, false);
  assert.equal(snapshot().actionError?.reason, 'Nothing is running to extend.');
  assert.equal(snapshot().actionError?.missed, false);
  close();
  assert.equal(snapshot().actionError, null);
});

test('a failure with no popover open waits for the next one, marked as missed', async () => {
  const failing = deferred();
  toggle('pointer', chip);
  const running = act(label, failing.call);
  close();
  failing.settle(new Error('host went away'));
  await running;
  assert.equal(snapshot().actionError?.missed, true);
  assert.equal(snapshot().actionError?.label.failed, 'Extend');
  toggle('pointer', chip);
  assert.equal(snapshot().actionError?.reason, 'host went away');
  close();
  assert.equal(snapshot().actionError, null, 'shown once');
});

test('a new action clears the last failure', async () => {
  toggle('pointer', chip);
  await act(label, async () => refused);
  assert.notEqual(snapshot().actionError, null);
  const next = deferred();
  const running = act(label, next.call);
  assert.equal(snapshot().actionError, null);
  next.settle(ok);
  await running;
  close();
});

test('an action with no answer gives up, frees the next action and reads the state again', async () => {
  const methods: string[] = [];
  setClient({ call: async (method: string) => { methods.push(method); return { kind: 'off' }; } } as unknown as Rpc);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    toggle('pointer', chip);
    methods.length = 0;
    const hung = act(label, () => new Promise<ActionResult>(() => {}));
    mock.timers.tick(ACTION_TIMEOUT_MS - 1);
    await Promise.resolve();
    assert.deepEqual(snapshot().pending, label, 'still waiting just before the bound');
    mock.timers.tick(1);
    assert.equal(await hung, false);
    assert.equal(snapshot().pending, null);
    assert.match(snapshot().actionError?.reason ?? '', new RegExp(`^no answer after ${ACTION_TIMEOUT_MS / 1000} s`));
    assert.deepEqual(methods, ['state']);
    assert.equal(await act(label, async () => ok), true, 'the next action runs');
  } finally {
    mock.timers.reset();
    setClient({ call: async () => ({ kind: 'off' }) } as unknown as Rpc);
  }
});

test('a refused or rejected action does not read the state again', async () => {
  const methods: string[] = [];
  setClient({ call: async (method: string) => { methods.push(method); return { kind: 'off' }; } } as unknown as Rpc);
  try {
    toggle('pointer', chip);
    methods.length = 0;
    await act(label, async () => refused);
    await act(label, async () => { throw new Error('host went away'); });
    assert.deepEqual(methods, [], 'only an action with no answer leaves the state in doubt');
  } finally {
    setClient({ call: async () => ({ kind: 'off' }) } as unknown as Rpc);
  }
});

test('a failed state read shows until the next read, and a successful read clears it', async () => {
  const reads: Array<() => Promise<unknown>> = [async () => { throw new Error('host went away'); }, async () => ({ kind: 'off' })];
  setClient({ call: () => reads.shift()!() } as unknown as Rpc);
  await refresh();
  assert.equal(snapshot().readError, 'host went away');
  await refresh();
  assert.equal(snapshot().readError, null);
  assert.deepEqual(snapshot().view, { kind: 'off' });
  setClient({ call: async () => ({ kind: 'off' }) } as unknown as Rpc);
});

test('only an opening from the chip returns focus to the chip', () => {
  toggle('keyboard', chip);
  assert.equal(snapshot().open?.fromChip, true);
  close();
  // Alt+K looks for a visible chip to place under; there is none here.
  Object.assign(globalThis, { document: { querySelectorAll: () => [] } });
  try {
    toggle('keyboard');
    assert.equal(snapshot().open?.fromChip, false, 'Alt+K: focus goes back to where it was');
  } finally {
    Reflect.deleteProperty(globalThis, 'document');
  }
});
