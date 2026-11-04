import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byLength, downsample, foldThreads, growth, histogram, rootOf, stats, type InsightPoint } from './insights.ts';

const point = (threadId: string, usd: number, extra: Partial<InsightPoint> = {}): InsightPoint =>
  ({ threadId, title: threadId, provider: 'claude-code', usd, requests: 10, turns: 2, peakContext: 40_000, subThreads: 0, ...extra });

test('statistics report the middle, the spread and how concentrated spend is', () => {
  const result = stats([1, 2, 3, 4, 100]);
  assert.equal(result.median, 3);
  assert.equal(result.mean, 22);
  assert.equal(result.max, 100);
  // The top tenth of five threads is one thread: 100 of 110.
  assert.ok(Math.abs(result.topTenShare - 100 / 110) < 1e-12);
  assert.ok(Math.abs(result.p90 - 61.6) < 1e-9);
});

test('sub-threads fold into the thread that started them', () => {
  const parents = new Map([['child', 'root'], ['grandchild', 'child']]);
  assert.equal(rootOf(parents, 'grandchild'), 'root');
  assert.equal(rootOf(new Map([['a', 'b'], ['b', 'a']]), 'a').length, 1);
  const folded = foldThreads([point('root', 1), point('child', 2, { peakContext: 90_000 }), point('grandchild', 3), point('solo', 5)],
    parents, () => undefined);
  assert.deepEqual(folded.map(value => [value.threadId, value.usd, value.requests, value.peakContext, value.subThreads]),
    [['root', 6, 30, 90_000, 2], ['solo', 5, 10, 40_000, 0]]);
});

test('a sub-thread whose root spent nothing still folds under the root', () => {
  const folded = foldThreads([point('child', 2)], new Map([['child', 'root']]),
    id => id === 'root' ? { title: 'Root thread', provider: 'codex' } : undefined);
  assert.deepEqual(folded.map(value => [value.threadId, value.title, value.provider, value.subThreads]), [['root', 'Root thread', 'codex', 1]]);
});

test('costs fall into decade bins and length bands', () => {
  const points = [point('a', 0.05), point('b', 0.5), point('c', 5, { requests: 300 }), point('d', 50, { requests: 300 })];
  assert.deepEqual(histogram(points).map(bin => bin.count), [1, 1, 1, 0, 0].map((value, index) => index === 3 ? 1 : value));
  const bands = byLength(points, 'requests');
  assert.deepEqual(bands.map(band => band.count), [2, 0, 0, 2, 0]);
  assert.ok(Math.abs(bands[3]!.perRequest - 55 / 600) < 1e-12);
});

test('growth compares the last tenth of requests with the first', () => {
  assert.equal(growth(Array(10).fill(1)), null);
  assert.equal(growth([...Array(10).fill(1), ...Array(10).fill(3)]), 3);
  const sampled = downsample(Array.from({ length: 1000 }, (_, i) => i), 100);
  assert.equal(sampled.length, 100);
  assert.equal(sampled[0]!.usd, 4.5);
});
