import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleFlight } from './single-flight.ts';

function gate() {
  const waiting: (() => void)[] = [];
  let runs = 0;
  const task = () => { runs++; return new Promise<void>(resolve => waiting.push(resolve)); };
  return { task, runs: () => runs, finish: async () => { waiting.shift()?.(); await new Promise(r => setTimeout(r, 0)); } };
}

test('a burst of triggers during a run costs one follow-up run', async () => {
  const g = gate();
  const flight = singleFlight(g.task);
  flight.trigger(); flight.trigger(); flight.trigger();
  assert.equal(g.runs(), 1);
  await g.finish();
  assert.equal(g.runs(), 2);
  await g.finish();
  assert.equal(g.runs(), 2);
});

test('held triggers wait for release, which always runs once', async () => {
  const g = gate();
  const flight = singleFlight(g.task);
  flight.hold(); flight.trigger();
  assert.equal(g.runs(), 0);
  flight.release();
  assert.equal(g.runs(), 1);
  await g.finish();
  flight.hold(); flight.release();
  assert.equal(g.runs(), 2);
});

test('release during a run queues a follow-up', async () => {
  const g = gate();
  const flight = singleFlight(g.task);
  flight.trigger(); flight.hold(); flight.release();
  await g.finish();
  assert.equal(g.runs(), 2);
});

test('a failing run does not stop later runs', async () => {
  let runs = 0;
  const flight = singleFlight(async () => { runs++; throw new Error('boom'); });
  flight.trigger(); await flight.idle(); flight.trigger(); await flight.idle();
  assert.equal(runs, 2);
});
