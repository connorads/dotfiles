import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionResult } from './domain.ts';
import { act, close, setClient, snapshot, toggle, type Rpc } from '../store.ts';

// The store reads state on every open; these tests only care about actions.
setClient({ call: async () => ({ kind: 'off' }) } as unknown as Rpc);
const chip = { getBoundingClientRect: () => ({ top: 0, right: 40, bottom: 28, left: 0 }) } as HTMLElement;
const label = { doing: 'Extending', failed: 'Extend' };
const ok: ActionResult = { ok: true };
const refused: ActionResult = { ok: false, reason: 'Nothing is running to extend.', stoppedPrevious: false };

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
