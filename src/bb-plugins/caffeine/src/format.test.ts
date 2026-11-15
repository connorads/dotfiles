import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipFace, clockAt, durationLabel, humanAge, longDuration, remainingFraction, untilLabel } from './format.ts';

test('humanAge matches caffeine_human_age, flooring each unit', () => {
  // The matrix from caffeine-lib.bats, so the chip and the tmux pill never disagree.
  const cases: [number, string][] = [[0, '0s'], [59, '59s'], [60, '1m'], [3599, '59m'], [3600, '1h'], [86400, '1d'], [-5, '0s']];
  for (const [secs, text] of cases) assert.equal(humanAge(secs), text, `${secs}s`);
});

test('longDuration gives two units above an hour', () => {
  assert.equal(longDuration(6120), '1h 42m');
  assert.equal(longDuration(7200), '2h');
  assert.equal(longDuration(300), '5m');
  assert.equal(longDuration(40), '40s');
});

test('clockAt is local HH:MM on the same day', () => {
  const morning = new Date(2026, 9, 12, 8, 0).getTime();
  assert.equal(clockAt(new Date(2026, 9, 12, 9, 5).getTime(), morning), '09:05');
  assert.equal(clockAt(new Date(2026, 9, 12, 22, 2).getTime(), morning), '22:02');
});

test('clockAt names the weekday when the time falls on another day', () => {
  const lateMon = new Date(2026, 9, 12, 23, 50).getTime();
  assert.equal(clockAt(new Date(2026, 9, 13, 0, 20).getTime(), lateMon), 'Tue 00:20');
  assert.equal(clockAt(new Date(2026, 9, 15, 10, 37).getTime(), lateMon), 'Thu 10:37');
  assert.equal(untilLabel(new Date(2026, 9, 13, 7, 50).getTime(), lateMon), 'until Tue 07:50');
});

test('durationLabel reads like the tmux picker', () => {
  assert.deepEqual([1800, 3600, 7200, 28800].map(durationLabel), ['30 minutes', '1 hour', '2 hours', '8 hours']);
});

test('remainingFraction clamps to the session', () => {
  assert.equal(remainingFraction(50, 0, 100), 0.5);
  assert.equal(remainingFraction(200, 0, 100), 0);
  assert.equal(remainingFraction(-50, 0, 100), 1);
});

const now = new Date(2026, 9, 12, 14, 32).getTime();
const min = 60_000;

test('chip hides when off or unsupported', () => {
  assert.equal(chipFace({ kind: 'off' }, now), null);
  assert.equal(chipFace({ kind: 'unsupported', reason: 'no-lib' }, now), null);
});

test('chip faces follow the tmux pill', () => {
  assert.deepEqual(chipFace({ kind: 'on', deadline: null, startedAt: now }, now),
    { tone: 'on', glyph: '☼', token: '∞', title: 'Keeping this Mac awake indefinitely' });
  assert.deepEqual(chipFace({ kind: 'on', deadline: now + 42 * min, startedAt: now }, now),
    { tone: 'on', glyph: '☼', token: '42m', title: 'Keeping this Mac awake for 42m, until 15:14' });
  assert.deepEqual(chipFace({ kind: 'lid', deadline: now + 42 * min, startedAt: now }, now),
    { tone: 'lid', glyph: '✷', token: '42m', title: 'You can close the lid. This Mac cannot sleep for 42m, until 15:14' });
  assert.deepEqual(chipFace({ kind: 'agents', busy: 2, graceUntil: null, leaseDeadline: now + 60 * min }, now),
    { tone: 'on', glyph: '☼', token: 'A2', title: 'Keeping this Mac awake while 2 agents run' });
  assert.deepEqual(chipFace({ kind: 'agents', busy: null, graceUntil: now + 4 * min + 30_000, leaseDeadline: now + 60 * min }, now),
    { tone: 'on', glyph: '☼', token: 'A·4m', title: 'No agents running. Keep-awake stops in 4m, at 14:36' });
  assert.equal(chipFace({ kind: 'agents', busy: null, graceUntil: null, leaseDeadline: null }, now)?.token, 'A');
});

test('chip title dates a deadline on another day', () => {
  assert.equal(chipFace({ kind: 'on', deadline: now + 3 * 24 * 60 * min, startedAt: now }, now)?.title,
    'Keeping this Mac awake for 3d, until Thu 14:32');
});

test('chip title names no past clock time once grace has run out', () => {
  assert.deepEqual(chipFace({ kind: 'agents', busy: null, graceUntil: now - 30_000, leaseDeadline: now + 60 * min }, now),
    { tone: 'on', glyph: '☼', token: 'A·0s', title: 'No agents running. Keep-awake is stopping now' });
});
