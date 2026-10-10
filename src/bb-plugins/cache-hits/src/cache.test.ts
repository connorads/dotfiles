import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bbSample, expiresAt, hitRatio, initialState, observe, type CacheState, type Observation } from './cache.ts';

const run = (observations: Observation[]) => observations.reduce<CacheState>(observe, initialState());
const request = (at: number, prompt: number, read: number, ttlMs: number | null = null): Observation =>
  ({ kind: 'usage', sample: { at, prompt, read, write: prompt - read, ttlMs } });

test('Codex input already contains cached tokens', () => {
  const sample = bbSample('codex', { inputTokens: 133468, cachedInputTokens: 133248, cacheReadInputTokens: 133248, cacheWriteInputTokens: 0 }, 1);
  assert.deepEqual(sample, { at: 1, prompt: 133468, read: 133248, write: 0, ttlMs: null });
});

test('Pi input excludes cache reads and writes', () => {
  const sample = bbSample('pi', { inputTokens: 22, cachedInputTokens: 630815, cacheReadInputTokens: 577111, cacheWriteInputTokens: 53704 }, 1);
  assert.equal(sample.prompt, 630837);
  assert.equal(Math.round(hitRatio(sample.read, sample.prompt)! * 100), 91);
});

test('a request that re-sends the previous prompt uncached counts as a miss with its idle gap', () => {
  const state = run([request(0, 100000, 99000), request(420000, 101000, 0)]);
  assert.equal(state.misses, 1);
  assert.deepEqual(state.lastMiss, { at: 420000, tokens: 100000, idleMs: 420000 });
});

test('the uncached tail of a warm request is noise, not a miss', () => {
  const state = run([request(0, 100000, 99000), request(1, 101500, 100224)]);
  assert.equal(state.misses, 0);
});

test('compaction resets the baseline, so the smaller rebuilt prompt is not a miss', () => {
  const state = run([request(0, 150000, 149000), { kind: 'reset' }, request(1, 30000, 0), request(2, 31000, 29952)]);
  assert.equal(state.misses, 0);
});

test('every read refreshes the cache lifetime from the last write', () => {
  const hour = 3_600_000;
  const state = run([request(0, 50000, 0, hour), request(600000, 51000, 50000)]);
  assert.equal(expiresAt(state), 600000 + hour);
});

test('expiry is unknown until a request reports its cache lifetime', () => {
  assert.equal(expiresAt(run([request(0, 50000, 49000)])), null);
});
