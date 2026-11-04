import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Ledger, migrations } from './ledger.ts';
import { parseLiteLlm } from './prices.ts';
import type { UsageRecord } from './records.ts';
import { summarise, threadCost } from './report.ts';

function ledger() {
  const db = new DatabaseSync(':memory:');
  for (const statement of migrations) db.exec(statement);
  return new Ledger(db);
}
const record = (key: string, extra: Partial<UsageRecord> = {}): UsageRecord => ({
  key, provider: 'claude-code', sessionId: 'sess-1', at: new Date(2026, 10, 3, 12).getTime(), model: 'claude-opus-5-5',
  input: 1000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 1000, reasoning: 0, speed: 'standard', webSearches: 0, ...extra,
});
const filler = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`model-${i}`, { mode: 'chat', input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 }]));
const cards = parseLiteLlm({ ...filler, 'claude-opus-5-5': { mode: 'chat', input_cost_per_token: 4e-6, output_cost_per_token: 2e-5 } });
const cursor = { size: 10, offset: 10, context: {} };

test('a request seen again keeps its larger copy and counts once', () => {
  const store = ledger();
  store.ingest('host', '/a.jsonl', cursor, [record('k1', { output: 10 })]);
  store.ingest('host', '/a.jsonl', cursor, [record('k1', { output: 1000 }), record('k1', { output: 5 })]);
  store.mapThread({ threadId: 'thr_1', title: 'Fix', projectId: null, provider: 'claude-code' }, ['sess-1'], 1);
  const cost = threadCost(store.threadRows('thr_1'), cards);
  assert.equal(cost.requests, 1);
  // 1000×4e-6 + 1000×2e-5
  assert.ok(Math.abs(cost.usd - 0.024) < 1e-12);
  assert.equal(store.counts().requests, 1);
});

test('file cursors survive with their parser context', () => {
  const store = ledger();
  store.ingest('host', '/codex.jsonl', { size: 99, offset: 80, context: { sessionId: 's', model: 'gpt-6.1-sol' } }, []);
  assert.deepEqual(store.cursors('host').get('/codex.jsonl'), { size: 99, offset: 80, context: { sessionId: 's', model: 'gpt-6.1-sol' } });
});

test('the summary fills empty days, separates usage outside BB, and counts unpriced models', () => {
  const store = ledger();
  store.ingest('host', '/a.jsonl', cursor, [
    record('k1'),
    record('k2', { sessionId: 'cli-session' }),
    record('k3', { model: 'codex-auto-review', provider: 'codex', at: new Date(2026, 10, 1, 9).getTime() }),
  ]);
  store.mapThread({ threadId: 'thr_1', title: 'Fix', projectId: null, provider: 'claude-code' }, ['sess-1'], 1);
  const summary = summarise(store.rowsSince(0), cards, '2026-11-01', '2026-11-04');
  assert.deepEqual(summary.days.map(day => [day.day, Math.round(day.usd * 1000)]),
    [['2026-11-01', 0], ['2026-11-02', 0], ['2026-11-03', 48], ['2026-11-04', 0]]);
  assert.deepEqual(summary.threads.map(line => [line.threadId, Math.round(line.usd * 1000)]), [['thr_1', 24], [null, 24]]);
  assert.equal(summary.total.unpricedTokens, 2000);
  assert.equal(summary.models.find(model => model.model === 'codex-auto-review')?.priced, false);
});
