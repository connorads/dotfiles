import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcome } from './outcome.ts';

const run = (code: number | null, stderr = '') => ({ code, stdout: '', stderr });

test('exit 0 is success for every op', () => {
  for (const op of ['start', 'startLid', 'extend', 'stop', 'clear'] as const) assert.deepEqual(outcome(op, run(0)), { ok: true });
});

test('lid starts explain why the flag did not take', () => {
  assert.match((outcome('startLid', run(3)) as { reason: string }).reason, /no pmset/);
  const failed = outcome('startLid', run(4));
  assert.equal(failed.ok, false);
  assert.match((failed as { reason: string }).reason, /SleepDisabled flag did not take.*Nothing was started/);
  assert.equal((failed as { stoppedPrevious: boolean }).stoppedPrevious, false);
});

test('a failed lid extension says the session it extended has stopped', () => {
  const failed = outcome('extend', run(4)) as { reason: string; stoppedPrevious: boolean };
  assert.match(failed.reason, /no longer kept awake/);
  assert.equal(failed.stoppedPrevious, true);
});

test('extend refusals map from caffeine_extend_total', () => {
  assert.deepEqual(outcome('extend', run(11)), { ok: false, reason: 'Nothing is running to extend.', stoppedPrevious: false });
  assert.deepEqual(outcome('extend', run(13)), { ok: false, reason: 'An indefinite session has nothing to extend.', stoppedPrevious: false });
});

test('clear tells nothing-to-clear from a refused sudo', () => {
  assert.deepEqual(outcome('clear', run(9)), { ok: false, reason: 'Nothing to clear.', stoppedPrevious: false });
  assert.match((outcome('clear', run(1)) as { reason: string }).reason, /sudo refused.*20-caffeine-pmset/);
});

test('an unknown failure keeps the last stderr line', () => {
  assert.deepEqual(outcome('stop', run(7, 'noise\nkill: boom\n')),
    { ok: false, reason: 'caffeine stop failed (exit 7): kill: boom.', stoppedPrevious: false });
});
