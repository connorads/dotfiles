import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bbSample, cacheStateSchema, expiresAt, HISTORY_LIMIT, hitRatio, initialState, observe, type CacheState, type Observation } from './cache.ts';

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
  assert.deepEqual(state.lastMiss, { at: 420000, tokens: 100000, idleMs: 420000, cause: 'idle' });
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

test('an account switch makes a warm cache cold at once', () => {
  const hour = 3_600_000;
  const state = run([request(0, 100000, 99000, hour), { kind: 'invalidate', at: 60000 }]);
  assert.equal(expiresAt(state), 60000);
});

test('the request after an account switch is a miss caused by the switch and warms the cache again', () => {
  const hour = 3_600_000;
  const state = run([request(0, 100000, 99000, hour), { kind: 'invalidate', at: 60000 }, request(120000, 101000, 12000, hour)]);
  assert.equal(state.misses, 1);
  assert.equal(state.lastMiss?.cause, 'account');
  assert.equal(expiresAt(state), 120000 + hour);
});

test('state stored before account switches were tracked still parses', () => {
  const stored = { last: null, ttlMs: null, prompt: 1, read: 1, misses: 1, missedTokens: 2000, lastMiss: { at: 1, tokens: 2000, idleMs: 5 } };
  const state = cacheStateSchema.parse(stored);
  assert.equal(state.invalidatedAt, null);
  assert.equal(state.lastMiss?.cause, 'idle');
});

test('history keeps each request with its miss, newest last, capped at the limit', () => {
  const observations = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => request(i * 1000, 10000 + i * 100, 10000 + i * 100 - 100));
  const state = run([...observations, request(900_000_000, 20000, 0)]);
  assert.equal(state.history.length, HISTORY_LIMIT);
  assert.deepEqual(state.history.at(-1), { at: 900_000_000, prompt: 20000, read: 0, write: 20000, afterReset: false,
    miss: { tokens: 10000 + (HISTORY_LIMIT + 4) * 100, idleMs: 900_000_000 - (HISTORY_LIMIT + 4) * 1000, cause: 'idle' } });
  assert.equal(state.history.at(-2)?.miss, null);
});

test('history marks the first request after compaction', () => {
  const state = run([request(0, 150000, 149000), { kind: 'reset' }, request(1, 30000, 0)]);
  assert.deepEqual(state.history.map(entry => entry.afterReset), [false, true]);
});

test('state stored before history was kept parses with an empty history', () => {
  const stored = { last: null, ttlMs: null, prompt: 1, read: 1, misses: 0, missedTokens: 0, lastMiss: null, invalidatedAt: null };
  assert.deepEqual(cacheStateSchema.parse(stored).history, []);
});
