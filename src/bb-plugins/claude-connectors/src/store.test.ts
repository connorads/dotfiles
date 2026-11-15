import assert from 'node:assert/strict';
import { test } from 'node:test';
import { close, loadKey, save, setClient, snapshot, toggle, type Rpc, type Target } from '../store.ts';

// toggle() refreshes in the background; a client that never answers keeps these tests about saves.
setClient({ call: () => new Promise(() => {}) } as unknown as Rpc);
const chip = { getBoundingClientRect: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) } as HTMLElement;
const target: Target = { kind: 'thread', threadId: 'thr_test01', projectId: 'prj_test01' };
const saved = () => snapshot().saves.get(loadKey(target));

function deferred() {
  let settle!: { resolve: () => void; reject: (cause: Error) => void };
  const promise = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
  return { promise, ...settle };
}

test('a second save for the same target waits for the first, even from a reopened popover', async () => {
  const first = deferred();
  toggle(target, 'pointer', chip);
  const running = save(target, 'p:personal', () => first.promise);
  close();
  toggle(target, 'pointer', chip);
  assert.deepEqual(saved(), { row: 'p:personal', error: null });
  assert.equal(await save(target, 'p:work', async () => {}), false);
  first.resolve();
  assert.equal(await running, true);
  assert.equal(saved(), undefined);
  assert.equal(await save(target, 'p:work', async () => {}), true);
  close();
});

test('a save that fails after the popover closed keeps its error until a popover showing it closes', async () => {
  const failing = deferred();
  toggle(target, 'pointer', chip);
  const running = save(target, 'off', () => failing.promise);
  close();
  failing.reject(new Error('proxy unavailable'));
  assert.equal(await running, false);
  assert.deepEqual(saved(), { row: 'off', error: 'proxy unavailable' });
  toggle(target, 'pointer', chip);
  assert.equal(saved()?.error, 'proxy unavailable');
  close();
  assert.equal(saved(), undefined);
});
