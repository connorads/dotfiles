import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseGeminiJson, parseGrokUsage, type Turn, type UsageRecord } from './records.ts';

type Json = Record<string, unknown>;
const object = (value: unknown): Json | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
const text = (value: unknown) => typeof value === 'string' && value ? value : undefined;
const time = (value: unknown) => {
  const at = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : undefined;
};

export interface SourceResult {
  records: UsageRecord[];
  turns: Turn[];
  sessions: Record<string, string>;
  nextSinceMs?: number;
}

function tableSet(db: DatabaseSync): Set<string> {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[];
  return new Set(rows.map(row => row.name));
}

function opencodeUsage(entry: { id: string; sessionId: string; model: string; at: number; tokens: Json }): UsageRecord | null {
  const { id, sessionId, model, at, tokens } = entry;
  const cache = object(tokens.cache);
  const input = count(tokens.input);
  const cacheRead = count(cache?.read);
  const cacheWrite5m = count(cache?.write);
  const reasoning = count(tokens.reasoning);
  // OpenCode stores reasoning separately from output; both bill at the output rate.
  const output = count(tokens.output) + reasoning;
  if (input + cacheRead + cacheWrite5m + output === 0) return null;
  return {
    key: `opencode:${id}`, provider: 'opencode', sessionId, at, model,
    input, cacheRead, cacheWrite5m, cacheWrite1h: 0, output, reasoning, speed: 'standard', webSearches: 0,
  };
}

interface OpenCodeState { records: UsageRecord[]; turns: Turn[]; sessions: Record<string, string>; seen: Set<string>; maxUpdated: number }

function readOpenCodeV2(db: DatabaseSync, sinceMs: number, state: OpenCodeState) {
  const rows = db.prepare(`SELECT m.id, m.session_id, m.type, m.time_created, m.time_updated, m.data, s.directory
    FROM session_message m LEFT JOIN session_v2 s ON s.id = m.session_id
    WHERE m.time_updated >= ? AND m.type IN ('assistant', 'user')`).all(sinceMs) as
    { id: string; session_id: string; type: string; time_created: number; time_updated: number; data: string; directory: string | null }[];
  for (const row of rows) {
    if (row.time_updated > state.maxUpdated) state.maxUpdated = row.time_updated;
    if (state.seen.has(row.id)) continue;
    state.seen.add(row.id);
    if (row.type === 'user') {
      const at = time(row.time_created);
      if (at !== undefined) state.turns.push({ key: `opencode:${row.id}`, sessionId: row.session_id, at });
      continue;
    }
    let data: Json | undefined;
    try { data = object(JSON.parse(row.data)); } catch { continue; }
    const tokens = object(data?.tokens);
    const model = text(object(data?.model)?.id);
    const at = time(object(data?.time)?.created) ?? time(row.time_created);
    if (!tokens || !model || at === undefined) continue;
    const record = opencodeUsage({ id: row.id, sessionId: row.session_id, model, at, tokens });
    if (!record) continue;
    state.records.push(record);
    const cwd = text(row.directory);
    if (cwd) state.sessions[row.session_id] = cwd;
  }
}

function readOpenCodeV1(db: DatabaseSync, sinceMs: number, state: OpenCodeState) {
  const rows = db.prepare(`SELECT m.id, m.session_id, m.time_created, m.time_updated, m.data, s.directory
    FROM message m LEFT JOIN session s ON s.id = m.session_id
    WHERE m.time_updated >= ?`).all(sinceMs) as
    { id: string; session_id: string; time_created: number; time_updated: number; data: string; directory: string | null }[];
  for (const row of rows) {
    if (row.time_updated > state.maxUpdated) state.maxUpdated = row.time_updated;
    if (state.seen.has(row.id)) continue;
    let data: Json | undefined;
    try { data = object(JSON.parse(row.data)); } catch { continue; }
    if (!data) continue;
    if (data.role === 'user') {
      state.seen.add(row.id);
      const at = time(object(data.time)?.created) ?? time(row.time_created);
      if (at !== undefined) state.turns.push({ key: `opencode:${row.id}`, sessionId: row.session_id, at });
      continue;
    }
    if (data.role !== 'assistant') continue;
    state.seen.add(row.id);
    const tokens = object(data.tokens);
    const model = text(data.modelID) ?? text(object(data.model)?.id);
    const at = time(object(data.time)?.created) ?? time(row.time_created);
    if (!tokens || !model || at === undefined) continue;
    const record = opencodeUsage({ id: row.id, sessionId: row.session_id, model, at, tokens });
    if (!record) continue;
    state.records.push(record);
    const cwd = text(row.directory) ?? text(object(data.path)?.cwd);
    if (cwd) state.sessions[row.session_id] = cwd;
  }
}

/**
 * Read OpenCode's SQLite database incrementally from `sinceMs` across both v2 (`session_message`)
 * and v1 (`message`) tables. Shared message IDs deduplicate so migrated rows count once.
 */
export function readOpenCodeDb(dbPath: string, sinceMs = 0): SourceResult {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = tableSet(db);
    const state: OpenCodeState = { records: [], turns: [], sessions: {}, seen: new Set(), maxUpdated: sinceMs };
    if (tables.has('session_message') && tables.has('session_v2')) readOpenCodeV2(db, sinceMs, state);
    if (tables.has('message') && tables.has('session')) readOpenCodeV1(db, sinceMs, state);
    return { records: state.records, turns: state.turns, sessions: state.sessions, nextSinceMs: state.maxUpdated };
  } finally {
    db.close();
  }
}

const epochMs = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
};

/** Read Hermes Agent's SQLite state database (`~/.hermes/state.db`) incrementally by session timestamp. */
export function readHermesDb(dbPath: string, sinceMs = 0): SourceResult {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = tableSet(db);
    if (!tables.has('sessions')) return { records: [], turns: [], sessions: {}, nextSinceMs: sinceMs };
    const sinceSec = sinceMs / 1000;
    const rows = db.prepare(`SELECT id, model, started_at, ended_at, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, cwd
      FROM sessions WHERE COALESCE(ended_at, started_at) >= ? AND (input_tokens > 0 OR output_tokens > 0)`).all(sinceSec) as
      { id: string; model: string | null; started_at: number; ended_at: number | null; input_tokens: number; output_tokens: number;
        cache_read_tokens: number; cache_write_tokens: number; reasoning_tokens: number; cwd: string | null }[];
    const records: UsageRecord[] = [];
    const turns: Turn[] = [];
    const sessions: Record<string, string> = {};
    let maxUpdated = sinceMs;
    for (const row of rows) {
      const at = epochMs(row.ended_at ?? row.started_at);
      const model = text(row.model);
      if (at === undefined || !model) continue;
      if (at > maxUpdated) maxUpdated = at;
      const output = count(row.output_tokens);
      records.push({
        key: `hermes:${row.id}`, provider: 'hermes', sessionId: row.id, at, model,
        input: count(row.input_tokens), cacheRead: count(row.cache_read_tokens),
        cacheWrite5m: count(row.cache_write_tokens), cacheWrite1h: 0,
        output, reasoning: Math.min(output, count(row.reasoning_tokens)), speed: 'standard', webSearches: 0,
      });
      const cwd = text(row.cwd);
      if (cwd) sessions[row.id] = cwd;
    }
    if (tables.has('messages')) {
      const msgRows = db.prepare(`SELECT id, session_id, timestamp FROM messages WHERE role = 'user' AND timestamp >= ?`).all(sinceSec) as
        { id: number; session_id: string; timestamp: number }[];
      for (const row of msgRows) {
        const at = epochMs(row.timestamp);
        if (at !== undefined) turns.push({ key: `hermes:${row.session_id}:${row.id}`, sessionId: row.session_id, at });
      }
    }
    return { records, turns, sessions, nextSinceMs: maxUpdated };
  } finally {
    db.close();
  }
}

/** Look up an Antigravity conversation's primary workspace path from its sibling `conversation_summaries.db`. */
export function readAgyWorkspaceCwd(agyRoot: string, sessionId: string): string | undefined {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(join(agyRoot, 'conversation_summaries.db'), { readOnly: true });
    const row = db.prepare('SELECT workspace_uris FROM conversation_summaries WHERE conversation_id = ?').get(sessionId) as
      { workspace_uris?: string } | undefined;
    if (!row?.workspace_uris) return undefined;
    const uris = JSON.parse(row.workspace_uris) as unknown;
    if (!Array.isArray(uris)) return undefined;
    for (const uri of uris) {
      if (typeof uri === 'string' && uri.startsWith('file://')) {
        try { return fileURLToPath(uri); } catch { continue; }
      }
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

/** Read a Grok Build `usage.json` file alongside its `summary.json` (or URL-encoded parent folder) for cwd. */
export async function readGrokFile(usagePath: string): Promise<SourceResult> {
  const raw = JSON.parse(await readFile(usagePath, 'utf8')) as unknown;
  const sessionDir = dirname(usagePath);
  let cwd: string | undefined;
  try {
    const summary = object(JSON.parse(await readFile(join(sessionDir, 'summary.json'), 'utf8')));
    cwd = text(object(summary?.info)?.cwd);
  } catch { /* fall back to encoded folder name */ }
  if (!cwd) {
    const encoded = dirname(sessionDir).split('/').pop();
    if (encoded) {
      try {
        const decoded = decodeURIComponent(encoded);
        if (decoded.startsWith('/')) cwd = decoded;
      } catch { /* ignore malformed encoding */ }
    }
  }
  return parseGrokUsage(raw, cwd);
}

/** Read Gemini CLI's sibling `.project_root` file for a chat log under `~/.gemini/tmp/<project>/chats/`. */
export async function readGeminiProjectRoot(chatPath: string): Promise<string | undefined> {
  try {
    const root = (await readFile(join(dirname(dirname(chatPath)), '.project_root'), 'utf8')).trim();
    return root || undefined;
  } catch {
    return undefined;
  }
}

/** Read a monolithic Gemini CLI `session-*.json` file. */
export async function readGeminiJsonFile(jsonPath: string): Promise<SourceResult> {
  const [raw, cwd] = await Promise.all([readFile(jsonPath, 'utf8').then(content => JSON.parse(content) as unknown), readGeminiProjectRoot(jsonPath)]);
  return parseGeminiJson(raw, cwd);
}
