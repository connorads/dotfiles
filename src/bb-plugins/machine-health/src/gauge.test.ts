// Cases ported from ~/.config/zsh/tests/mem-lib.bats so both surfaces agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armGap, armState, bindingArm, causeOf, pctOf, pressureFrom, ratioOf, readable, readGauge, segmentLines, slotLines, stateOf, tokenOf } from './gauge.ts';

test('state follows the arm lines and critical pressure, not warn pressure', () => {
  assert.equal(stateOf(1, 59, 69), 'OK');
  assert.equal(stateOf(1, 60, 0), 'BUSY');
  assert.equal(stateOf(1, 0, 70), 'BUSY');
  assert.equal(stateOf(1, 80, 0), 'CRITICAL');
  assert.equal(stateOf(1, 0, 85), 'CRITICAL');
  assert.equal(stateOf(2, 30, 30), 'OK');
  assert.equal(stateOf(4, 0, 0), 'CRITICAL');
});

test('cause names what drives the state', () => {
  assert.equal(causeOf(1, 30, 30), 'none');
  assert.equal(causeOf(2, 30, 30), 'none');
  assert.equal(causeOf(1, 62, 27), 'slots');
  assert.equal(causeOf(1, 26, 72), 'segments');
  assert.equal(causeOf(4, 30, 30), 'pressure');
  assert.equal(causeOf(2, 62, 27), 'slots');
  assert.equal(causeOf(4, 85, 90), 'pressure');
  assert.equal(causeOf(2, 82, 0), 'slots');
  assert.equal(causeOf(1, 62, 72), 'segments');
  assert.equal(causeOf(1, 82, 84), 'slots');
});

test('ties between the arms bind to slots', () => {
  assert.equal(bindingArm(65, 60, 65, 60), 'slots');
});

test('token is the binding arm figure, marked under warn or critical pressure', () => {
  assert.equal(tokenOf(2, 30, 30), '▲30%');
  assert.equal(tokenOf(4, 30, 30), '▲30%');
  assert.equal(tokenOf(2, 62, 27), '▲62%');
  assert.equal(tokenOf(1, 62, 27), '62%');
  assert.equal(tokenOf(1, 26, 72), '72%');
  assert.equal(tokenOf(1, 26, 27), '27%');
});

test('percentages truncate and an unknown limit reads zero', () => {
  assert.equal(pctOf(629, 1000), 62);
  assert.equal(pctOf(999, 1000), 99);
  assert.equal(pctOf(5, 0), 0);
  assert.equal(ratioOf(750, 100), 7.5);
  assert.equal(ratioOf(750, 0), 0);
});

test('each arm is judged by its own lines with the distance to the next one', () => {
  assert.equal(armState(59, slotLines), 'OK');
  assert.equal(armState(60, slotLines), 'BUSY');
  assert.equal(armState(80, slotLines), 'CRITICAL');
  assert.equal(armState(69, segmentLines), 'OK');
  assert.equal(armState(85, segmentLines), 'CRITICAL');
  assert.deepEqual(armGap(59, slotLines), { points: 1, to: 'to amber' });
  assert.deepEqual(armGap(60, slotLines), { points: 20, to: 'to red' });
  assert.deepEqual(armGap(80, slotLines), { points: 0, to: 'over red' });
  assert.deepEqual(armGap(84, segmentLines), { points: 1, to: 'to red' });
});

test('pressure outside the documented set reads normal', () => {
  assert.equal(pressureFrom('4'), 4);
  assert.equal(pressureFrom('2\n'), 2);
  assert.equal(pressureFrom('3'), 1);
  assert.equal(pressureFrom(undefined), 1);
});

test('one reading yields state, sizes and which arm fills first', () => {
  const gauge = readGauge({
    pressure: 2, pages: 1113195, pagesLimit: 6457536, segments: 155118, segmentsLimit: 807192,
    pageSize: 16384, segmentSize: 65536, swapUsedMb: 6002, swapTotalMb: 7168, wiredMb: 3600,
  });
  assert.equal(gauge.state, 'OK');
  assert.equal(gauge.token, '▲19%');
  assert.equal(gauge.slots.pct, 17);
  assert.equal(gauge.segments.pct, 19);
  assert.equal(gauge.slots.usedGib, 17);
  assert.equal(gauge.slots.limitGib, 98.5);
  assert.deepEqual(gauge.ratio, { now: 7.2, limits: 8, fillsFirst: 'segments' });
});

test('absent sysctls (non-macOS) read a flat OK but are flagged unreadable', () => {
  const raw = { pressure: 1 as const, pages: 0, pagesLimit: 0, segments: 0, segmentsLimit: 0,
    pageSize: 16384, segmentSize: 65536, swapUsedMb: 0, swapTotalMb: 0, wiredMb: 0 };
  const gauge = readGauge(raw);
  assert.equal(gauge.state, 'OK');
  assert.equal(gauge.token, '0%');
  assert.equal(readable(raw), false);
  assert.equal(readable({ ...raw, pagesLimit: 1000, segmentsLimit: 1000 }), true);
});
