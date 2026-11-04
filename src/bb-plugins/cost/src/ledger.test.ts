import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Ledger, migrations } from './ledger.ts';
import { parseLiteLlm } from './prices.ts';
import type { UsageRecord } from './records.ts';
import { groupProjects, summarise, threadCost } from './report.ts';

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
  store.ingest('host', '/a.jsonl', { cursor, records: [record('k1', { output: 10 })] });
  store.ingest('host', '/a.jsonl', { cursor, records: [record('k1', { output: 1000 }), record('k1', { output: 5 })] });
  store.mapThread({ threadId: 'thr_1', title: 'Fix', projectId: null, provider: 'claude-code', parentId: null }, ['sess-1'], 1);
  const cost = threadCost(store.threadRows('thr_1'), cards);
  assert.equal(cost.requests, 1);
  // 1000×4e-6 + 1000×2e-5
  assert.ok(Math.abs(cost.usd - 0.024) < 1e-12);
  assert.equal(store.counts().requests, 1);
});

test('file cursors survive with their parser context', () => {
  const store = ledger();
  store.ingest('host', '/codex.jsonl', { cursor: { size: 99, offset: 80, context: { sessionId: 's', model: 'gpt-6.1-sol' } }, records: [] });
  assert.deepEqual(store.cursors('host').get('/codex.jsonl'), { size: 99, offset: 80, context: { sessionId: 's', model: 'gpt-6.1-sol' } });
});

test('the summary fills empty days, separates usage outside BB, and counts unpriced models', () => {
  const store = ledger();
  store.ingest('host', '/a.jsonl', { cursor, records: [
    record('k1', { output: 2000 }),
    record('k2', { sessionId: 'cli-session' }),
    record('k3', { model: 'codex-auto-review', provider: 'codex', sessionId: 'cli-codex', at: new Date(2026, 10, 1, 9).getTime() }),
  ], sessions: { 'sess-1': '/work/app', 'cli-session': '/work/game', 'cli-codex': '/work/game' } });
  store.mapThread({ threadId: 'thr_1', title: 'Fix', projectId: null, provider: 'claude-code', parentId: null }, ['sess-1'], 1);
  const summary = summarise(store.rowsSince(0), cards, '2026-11-01', '2026-11-04');
  assert.deepEqual(summary.days.map(day => [day.day, Math.round(day.usd * 1000)]),
    [['2026-11-01', 0], ['2026-11-02', 0], ['2026-11-03', 68], ['2026-11-04', 0]]);
  // Usage outside BB groups by directory; a mapped thread never shows its directory.
  assert.deepEqual(summary.threads.map(line => [line.threadId, line.cwd, Math.round(line.usd * 1000), line.providers]),
    [['thr_1', null, 44, ['claude-code']], [null, '/work/game', 24, ['claude-code', 'codex']]]);
  assert.equal(summary.total.unpricedTokens, 2000); // k3: 1000 input + 1000 output
  assert.equal(summary.models.find(model => model.model === 'codex-auto-review')?.priced, false);
});

test('projects gather their threads and the CLI usage in their checkouts', () => {
  const store = ledger();
  store.ingest('host', '/a.jsonl', { cursor, records: [
    record('k1'), record('k2', { sessionId: 'cli-in-app' }), record('k3', { sessionId: 'cli-elsewhere' }),
  ], sessions: { 'sess-1': '/work/app', 'cli-in-app': '/work/app/packages/web', 'cli-elsewhere': '/work/scratch' } });
  store.mapThread({ threadId: 'thr_1', title: 'Fix', projectId: 'proj_app', provider: 'claude-code', parentId: null }, ['sess-1'], 1);
  const { threads } = summarise(store.rowsSince(0), cards, '2026-11-03', '2026-11-03');
  const app = { projectId: 'proj_app', name: 'app' };
  const projects = groupProjects(threads, () => app, cwd => cwd.startsWith('/work/app') ? app : null);
  assert.deepEqual(projects.map(line => [line.name, line.threads, Math.round(line.usd * 1000), Math.round(line.outsideUsd * 1000)]),
    [['app', 1, 48, 24], ['scratch', 0, 24, 24]]);
});

test('thread lengths count requests, turns and the largest prompt', () => {
  const store = ledger();
  store.ingest('host', '/a.jsonl', { cursor, records: [record('k1', { cacheRead: 150_000 }), record('k2')],
    turns: [{ key: 't1', sessionId: 'sess-1', at: 1 }, { key: 't1', sessionId: 'sess-1', at: 1 }, { key: 't2', sessionId: 'sess-1', at: 2 }] });
  store.mapThread({ threadId: 'thr_1', title: 'Fix', projectId: null, provider: 'claude-code', parentId: 'thr_0' }, ['sess-1'], 1);
  assert.deepEqual(store.lengths(0).get('thr_1'), { requests: 2, turns: 2, peakContext: 151_000 });
  assert.deepEqual([...store.parents()], [['thr_1', 'thr_0']]);
  assert.equal(store.threadRequests('thr_1').length, 2);
});
