import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { readAgyWorkspaceCwd, readGeminiJsonFile, readGrokFile, readHermesDb, readOpenCodeDb } from './sources.ts';

test('readOpenCodeDb reads v2 and v1 tables, deduplicates shared ids, adds reasoning to output, and advances sinceMs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cost-opencode-'));
  const dbPath = join(dir, 'opencode.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT NOT NULL);
    CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT NOT NULL);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  `);
  db.prepare('INSERT INTO session_v2 VALUES (?, ?)').run('ses_2', '/work/demo');
  db.prepare('INSERT INTO session VALUES (?, ?)').run('ses_2', '/work/demo');
  db.prepare('INSERT INTO session VALUES (?, ?)').run('ses_1', '/work/legacy');
  const v2Asst = JSON.stringify({
    model: { id: 'glm-5.3-flash', providerID: 'opencode-go' },
    time: { created: 1000 },
    tokens: { input: 1000, output: 120, reasoning: 80, cache: { read: 5000, write: 50 } },
  });
  db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)').run('msg_u1', 'ses_2', 'user', 900, 900, '{}');
  db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)').run('msg_shared', 'ses_2', 'assistant', 1000, 1005, v2Asst);
  // Same id mirrored in v1 must not double-count.
  db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run('msg_shared', 'ses_2', 1000, 1005, JSON.stringify({
    role: 'assistant', modelID: 'glm-5.3-flash', tokens: { input: 1000, output: 120, reasoning: 80, cache: { read: 5000, write: 50 } },
  }));
  // Older v1-only message must still be read.
  db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run('msg_v1', 'ses_1', 500, 510, JSON.stringify({
    role: 'assistant', modelID: 'glm-5.2', tokens: { input: 300, output: 40, reasoning: 10, cache: { read: 0, write: 0 } },
  }));
  db.close();

  const first = readOpenCodeDb(dbPath, 0);
  assert.equal(first.records.length, 2);
  const shared = first.records.find(record => record.key === 'opencode:msg_shared')!;
  assert.deepEqual(shared, {
    key: 'opencode:msg_shared', provider: 'opencode', sessionId: 'ses_2', at: 1000, model: 'glm-5.3-flash',
    input: 1000, cacheRead: 5000, cacheWrite5m: 50, cacheWrite1h: 0, output: 200, reasoning: 80, speed: 'standard', webSearches: 0,
  });
  assert.deepEqual(first.turns, [{ key: 'opencode:msg_u1', sessionId: 'ses_2', at: 900 }]);
  assert.deepEqual(first.sessions, { ses_2: '/work/demo', ses_1: '/work/legacy' });
  assert.equal(first.nextSinceMs, 1005);

  // Incremental read from nextSinceMs skips older rows.
  const second = readOpenCodeDb(dbPath, first.nextSinceMs! + 1);
  assert.equal(second.records.length, 0);
  assert.equal(second.turns.length, 0);
});

test('readHermesDb reads sessions with usage and user turns', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cost-hermes-'));
  const dbPath = join(dir, 'state.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, started_at REAL, ended_at REAL, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, cwd TEXT);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, timestamp REAL);
  `);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'hermes-1', 'claude-opus-5-5', 1790000000, 1790000060, 500, 100, 2000, 50, 20, '/work/demo',
  );
  db.prepare('INSERT INTO messages (session_id, role, timestamp) VALUES (?, ?, ?)').run('hermes-1', 'user', 1790000005);
  db.close();

  const result = readHermesDb(dbPath, 0);
  assert.deepEqual(result.records, [{
    key: 'hermes:hermes-1', provider: 'hermes', sessionId: 'hermes-1', at: 1790000060000, model: 'claude-opus-5-5',
    input: 500, cacheRead: 2000, cacheWrite5m: 50, cacheWrite1h: 0, output: 100, reasoning: 20, speed: 'standard', webSearches: 0,
  }]);
  assert.deepEqual(result.turns, [{ key: 'hermes:hermes-1:1', sessionId: 'hermes-1', at: 1790000005000 }]);
  assert.deepEqual(result.sessions, { 'hermes-1': '/work/demo' });
});

test('readAgyWorkspaceCwd decodes the first file URI from conversation_summaries.db', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cost-agy-'));
  const db = new DatabaseSync(join(dir, 'conversation_summaries.db'));
  db.exec('CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, workspace_uris TEXT NOT NULL)');
  db.prepare('INSERT INTO conversation_summaries VALUES (?, ?)').run('conv-1', JSON.stringify(['file:///work/my%20app', 'file:///work/other']));
  db.close();

  assert.equal(readAgyWorkspaceCwd(dir, 'conv-1'), '/work/my app');
  assert.equal(readAgyWorkspaceCwd(dir, 'missing'), undefined);
});

test('readGrokFile and readGeminiJsonFile recover cwd from sibling metadata files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cost-files-'));
  const grokSession = join(dir, 'grok', encodeURIComponent('/work/fallback'), 'sess-1');
  await mkdir(grokSession, { recursive: true });
  await writeFile(join(grokSession, 'summary.json'), JSON.stringify({ info: { cwd: '/work/grok-app' } }));
  await writeFile(join(grokSession, 'usage.json'), JSON.stringify({
    sessionId: 'sess-1', updatedAt: '2026-11-01T10:00:00Z',
    turns: [{ turnNumber: 1, endedAt: '2026-11-01T10:00:00Z', modelUsage: { 'grok-4.7-build': { inputTokens: 200, cachedReadTokens: 50, outputTokens: 20 } } }],
  }));
  const grok = await readGrokFile(join(grokSession, 'usage.json'));
  assert.equal(grok.records[0]!.input, 150);
  assert.deepEqual(grok.sessions, { 'sess-1': '/work/grok-app' });

  const gemChats = join(dir, 'gemini', 'proj-1', 'chats');
  await mkdir(gemChats, { recursive: true });
  await writeFile(join(dir, 'gemini', 'proj-1', '.project_root'), '/work/gem-app\n');
  await writeFile(join(gemChats, 'session-1.json'), JSON.stringify({
    sessionId: 'gem-1',
    messages: [{ id: 'm1', type: 'gemini', timestamp: '2026-11-01T10:00:00Z', model: 'gemini-3.8-flash', tokens: { input: 300, cached: 100, output: 40, thoughts: 10 } }],
  }));
  const gem = await readGeminiJsonFile(join(gemChats, 'session-1.json'));
  assert.equal(gem.records[0]!.input, 200);
  assert.equal(gem.records[0]!.output, 50);
  assert.deepEqual(gem.sessions, { 'gem-1': '/work/gem-app' });
});
