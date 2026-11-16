import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeWork, getWork, idle, runningElsewhere, setWork, startView, subscribeWork, threadCount } from './actions.ts';

test('a running action on a machine locks the other threads on it, not its own or other machines', () => {
  setWork('thr_lock_a', { ...idle, running: 'stop', hostId: 'hst_bench' });
  assert.equal(runningElsewhere('hst_bench', 'thr_lock_b'), true);
  assert.equal(runningElsewhere('hst_bench', 'thr_lock_a'), false);
  assert.equal(runningElsewhere('hst_shed', 'thr_lock_b'), false);
  assert.equal(runningElsewhere(undefined, 'thr_lock_b'), false);
  setWork('thr_lock_a', { running: null, status: 'Process 41201 exited.' });
  assert.equal(runningElsewhere('hst_bench', 'thr_lock_b'), false);
  closeWork('thr_lock_a');
});

test('closing a dialog keeps a running action and drops a shown outcome', () => {
  setWork('thr_close', { ...idle, running: 'hibernate', hostId: 'hst_bench', status: 'Hibernating 1 thread…' });
  closeWork('thr_close');
  assert.equal(getWork('thr_close').running, 'hibernate');
  setWork('thr_close', { running: null, status: null, error: 'Hibernate failed: offline', retry: ['thr_tide'] });
  assert.deepEqual(getWork('thr_close').retry, ['thr_tide']);
  closeWork('thr_close');
  assert.equal(getWork('thr_close'), idle);
});

test('a dialog opens on Threads during a hibernate or after one failed, else on Services', () => {
  assert.equal(startView('thr_view'), 'services');
  setWork('thr_view', { ...idle, running: 'hibernate', hostId: 'hst_bench' });
  assert.equal(startView('thr_view'), 'threads');
  setWork('thr_view', { running: null, retry: ['thr_tide'] });
  assert.equal(startView('thr_view'), 'threads');
  setWork('thr_view', { ...idle, running: 'stop', hostId: 'hst_bench' });
  assert.equal(startView('thr_view'), 'services');
  setWork('thr_view', { running: null });
  closeWork('thr_view');
});

test('every change notifies subscribers until they unsubscribe', () => {
  let calls = 0;
  const stop = subscribeWork(() => { calls++; });
  setWork('thr_notify', { status: 'Stopping PID 41201…' });
  stop();
  setWork('thr_notify', { status: null });
  closeWork('thr_notify');
  assert.equal(calls, 1);
});

test('thread counts read naturally', () => {
  assert.equal(threadCount(1), '1 thread');
  assert.equal(threadCount(0), '0 threads');
  assert.equal(threadCount(3), '3 threads');
});
