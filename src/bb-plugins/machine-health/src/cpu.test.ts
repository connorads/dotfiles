import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCpuSampler, percentBetween, snapshot, type CpuSnapshot } from './cpu.ts';

const core = (busy: number, idle: number) => ({ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } });

test('snapshot sums busy and total ticks across cores', () => {
  assert.deepEqual(snapshot([core(10, 90), core(30, 70)]), { busy: 40, total: 200 });
});

test('percent is the busy share of ticks between two snapshots', () => {
  assert.equal(percentBetween({ busy: 40, total: 200 }, { busy: 65, total: 300 }), 25);
  assert.equal(percentBetween({ busy: 40, total: 200 }, { busy: 40, total: 200 }), null);
});

test('a skewed idle counter cannot read above 100%', () => {
  assert.equal(percentBetween({ busy: 0, total: 100 }, { busy: 150, total: 200 }), 100);
});

/** A fake machine: each read returns the next snapshot; the clock moves on sleep or by hand. */
function fakeMachine(snaps: CpuSnapshot[]) {
  let clock = 0;
  const sleeps: number[] = [];
  const sampler = createCpuSampler({
    read: () => snaps.shift() ?? assert.fail('unexpected read'),
    now: () => clock,
    sleep: async ms => { sleeps.push(ms); clock += ms; },
    windowMs: 250,
    maxAgeMs: 60_000,
  });
  return { sampler, sleeps, advance: (ms: number) => { clock += ms; } };
}

test('a cold sampler waits one window; a warm one diffs against its last call without waiting', async () => {
  const m = fakeMachine([{ busy: 0, total: 0 }, { busy: 50, total: 100 }, { busy: 60, total: 200 }]);
  assert.equal(await m.sampler(), 50);
  assert.deepEqual(m.sleeps, [250]);
  m.advance(10_000);
  assert.equal(await m.sampler(), 10);
  assert.deepEqual(m.sleeps, [250]);
});

test('a baseline older than maxAge is replaced by a fresh window', async () => {
  const m = fakeMachine([{ busy: 0, total: 0 }, { busy: 50, total: 100 }, { busy: 900, total: 1000 }, { busy: 910, total: 1100 }]);
  await m.sampler();
  m.advance(120_000);
  assert.equal(await m.sampler(), 10);
  assert.deepEqual(m.sleeps, [250, 250]);
});

test('a second call inside one window repeats the last figure', async () => {
  const m = fakeMachine([{ busy: 0, total: 0 }, { busy: 50, total: 100 }]);
  assert.equal(await m.sampler(), 50);
  m.advance(100);
  assert.equal(await m.sampler(), 50);
});
