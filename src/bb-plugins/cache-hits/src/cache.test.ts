import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitRatio, initialState, observe, toSample, type CacheState, type Observation } from './cache.ts';

const run = (providerId: string, observations: Observation[]) =>
  observations.reduce<CacheState>((state, observation) => observe(state, providerId, observation), initialState(providerId));
const codex = (at: number, input: number, cached: number): Observation =>
  ({ kind: 'usage', at, usage: { inputTokens: input, cachedInputTokens: cached, cacheReadInputTokens: cached, cacheWriteInputTokens: 0 } });
const claude = (at: number, input: number, read: number, write: number): Observation =>
  ({ kind: 'usage', at, usage: { inputTokens: input, cachedInputTokens: read + write, cacheReadInputTokens: read, cacheWriteInputTokens: write } });

test('Codex input already contains cached tokens', () => {
  const sample = toSample('codex', { inputTokens: 133468, cachedInputTokens: 133248, cacheReadInputTokens: 133248, cacheWriteInputTokens: 0 }, 1);
  assert.deepEqual(sample, { at: 1, prompt: 133468, read: 133248, write: 0 });
});

test('Claude Code and Pi input excludes cache reads and writes', () => {
  for (const providerId of ['claude-code', 'pi']) {
    const sample = toSample(providerId, { inputTokens: 22, cachedInputTokens: 630815, cacheReadInputTokens: 577111, cacheWriteInputTokens: 53704 }, 1);
    assert.equal(sample.prompt, 630837);
    assert.equal(Math.round(hitRatio(sample.read, sample.prompt)! * 100), 91);
  }
});

test('a request that re-sends the previous prompt uncached counts as a miss with its idle gap', () => {
  const state = run('codex', [codex(0, 100000, 99000), codex(420000, 101000, 0)]);
  assert.equal(state.misses, 1);
  assert.deepEqual(state.lastMiss, { at: 420000, tokens: 100000, idleMs: 420000 });
});

test('the uncached tail of a warm request is noise, not a miss', () => {
  const state = run('codex', [codex(0, 100000, 99000), codex(1, 101500, 100224)]);
  assert.equal(state.misses, 0);
  assert.equal(state.lastMiss, null);
});

test('compaction resets the baseline, so the smaller rebuilt prompt is not a miss', () => {
  const state = run('codex', [codex(0, 150000, 149000), { kind: 'reset' }, codex(1, 30000, 0), codex(2, 31000, 29952)]);
  assert.equal(state.misses, 0);
});

test('a warm Claude turn writes only what the context grew by', () => {
  const state = run('claude-code', [claude(0, 10, 100, 2000), { kind: 'context', used: 50000 }, claude(1, 10, 120000, 6000), { kind: 'context', used: 55000 }]);
  assert.equal(state.misses, 0);
  assert.equal(state.context, 55000);
});

test('a cold Claude turn rewrites the old prefix and counts it as a miss', () => {
  const state = run('claude-code', [claude(0, 10, 100, 2000), { kind: 'context', used: 51000 },
    claude(600000, 10, 0, 53000), { kind: 'context', used: 53000 }]);
  assert.equal(state.misses, 1);
  assert.deepEqual(state.lastMiss, { at: 600000, tokens: 51000, idleMs: 600000 });
});

test('context readings inside a turn do not move the turn baseline', () => {
  // This thread's real sequence: context streams mid-turn, then usage, then the end-of-turn context.
  const state = run('claude-code', [claude(0, 22, 577111, 53704), { kind: 'context', used: 69246 },
    { kind: 'context', used: 80369 }, { kind: 'context', used: 94970 }, claude(1, 36, 1464382, 26825), { kind: 'context', used: 96220 }]);
  assert.equal(state.misses, 0);
  assert.equal(state.context, 96220);
});

test('a Claude turn without a known prior context is not judged', () => {
  const state = run('claude-code', [claude(0, 10, 0, 50000), { kind: 'context', used: 50000 }]);
  assert.equal(state.misses, 0);
  assert.equal(state.read, 0);
  assert.equal(state.prompt, 50010);
});
