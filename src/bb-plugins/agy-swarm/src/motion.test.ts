import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Spring,
  extractDigits,
  initialShimmerState,
  nextOdometerOffset,
  reduceShimmer,
} from './motion.ts';

test('critically damped Spring reaches target cleanly with zero overshoot', () => {
  const spring = Spring.fromDuration(0, { duration: 0.15, bounce: 0 });
  spring.set(100);
  let maxVal = 0;
  for (let i = 0; i < 60; i++) {
    const v = spring.step(1 / 60);
    if (v > maxVal) maxVal = v;
  }
  assert.equal(spring.resting, true);
  assert.equal(spring.value, 100);
  assert.ok(maxVal <= 100.01, `expected no overshoot, got ${maxVal}`);
});

test('Spring clamps huge dt jumps and preserves velocity on mid-flight reversal', () => {
  const spring = Spring.fromDuration(0, { duration: 0.3, bounce: 0 });
  spring.set(100);
  spring.step(0.05);
  assert.ok(spring.velocity > 0);
  spring.set(0);
  const vAfterStep = spring.step(10); // clamped to 0.1s, must not explode
  assert.ok(Number.isFinite(vAfterStep));
  assert.ok(Math.abs(vAfterStep) < 150);
});

test('shimmer state machine transitions active -> fading -> inactive and ignores stale attempts', () => {
  let s = initialShimmerState(true, false);
  assert.equal(s.phase, 'active');

  const d1 = reduceShimmer(s, { type: 'deactivate' });
  s = d1.state;
  assert.equal(s.phase, 'fading');
  assert.equal(d1.effects[0]?.type, 'schedule-fade-done');
  const staleAttempt = s.attempt;

  // Reactivate mid-fade cancels timer and bumps attempt.
  const a1 = reduceShimmer(s, { type: 'activate' });
  s = a1.state;
  assert.equal(s.phase, 'active');
  assert.equal(a1.effects[0]?.type, 'cancel-timer');

  // Stale fade-done must be ignored.
  const stale = reduceShimmer(s, { type: 'fade-done', attempt: staleAttempt });
  assert.equal(stale.state.phase, 'active');

  // Proper deactivate + matching fade-done settles to inactive.
  const d2 = reduceShimmer(s, { type: 'deactivate' });
  const done = reduceShimmer(d2.state, { type: 'fade-done', attempt: d2.state.attempt });
  assert.equal(done.state.phase, 'inactive');
});

test('odometer rolls forward through 9 -> 0 instead of rewinding backward', () => {
  assert.deepEqual(extractDigits(42), [4, 2]);
  assert.equal(nextOdometerOffset(9, 0, 1), 20);
  assert.equal(nextOdometerOffset(0, 9, -1), 9);
  assert.equal(nextOdometerOffset(3, 7, 1), 17);
  assert.equal(nextOdometerOffset(5, 5, 1), 15);
});
