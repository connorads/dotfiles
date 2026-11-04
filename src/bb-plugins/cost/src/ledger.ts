import type { FileContext, Provider, Speed, Turn, UsageRecord } from './records.ts';
import type { RateCards } from './prices.ts';

/** The subset of better-sqlite3 the ledger uses; node:sqlite satisfies it in tests. */
export interface Statement { run(params?: object): unknown; all(params?: object): unknown[]; get(params?: object): unknown }
export interface Database { exec(sql: string): void; prepare(sql: string): Statement }

/** Append-only: bb.storage.migrate runs each statement once by index. */
export const migrations = [
  `CREATE TABLE requests (
    key TEXT PRIMARY KEY, provider TEXT NOT NULL, session_id TEXT NOT NULL, host_id TEXT NOT NULL, at INTEGER NOT NULL,
    model TEXT NOT NULL, input INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write_5m INTEGER NOT NULL,
    cache_write_1h INTEGER NOT NULL, output INTEGER NOT NULL, reasoning INTEGER NOT NULL, speed TEXT NOT NULL,
    web_searches INTEGER NOT NULL)`,
  `CREATE INDEX requests_session ON requests(session_id)`,
  `CREATE INDEX requests_at ON requests(at)`,
  `CREATE TABLE files (host_id TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL, offset INTEGER NOT NULL,
    context TEXT NOT NULL, PRIMARY KEY (host_id, path))`,
  `CREATE TABLE sessions (session_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL)`,
  `CREATE INDEX sessions_thread ON sessions(thread_id)`,
  `CREATE TABLE threads (thread_id TEXT PRIMARY KEY, title TEXT NOT NULL, project_id TEXT, provider TEXT NOT NULL,
    mapped_at INTEGER NOT NULL)`,
  `CREATE TABLE prices (id INTEGER PRIMARY KEY CHECK (id = 1), fetched_at INTEGER NOT NULL, cards TEXT NOT NULL)`,
  `CREATE TABLE session_info (session_id TEXT PRIMARY KEY, cwd TEXT NOT NULL)`,
  // Forget cursors so the next backfill reads every file again and fills session_info; request keys make it idempotent.
  `DELETE FROM files`,
  `CREATE TABLE turns (key TEXT PRIMARY KEY, session_id TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX turns_session ON turns(session_id)`,
  `ALTER TABLE threads ADD COLUMN parent_id TEXT`,
  // Read every file again to fill turns, and map every thread again to fill parents.
  `DELETE FROM files`,
  `UPDATE threads SET mapped_at = 0`,
];

export interface FileCursor { size: number; offset: number; context: FileContext }
export interface ThreadInfo { threadId: string; title: string; projectId: string | null; provider: string; parentId: string | null }

/** Token sums for requests sharing a price: model, speed and context tier, plus the grouping keys asked for. */
export interface UsageRow {
  day: string | null; provider: Provider; model: string; threadId: string | null; cwd: string | null; speed: Speed;
  over200k: number; over272k: number; requests: number; input: number; cacheRead: number;
  cacheWrite5m: number; cacheWrite1h: number; output: number; webSearches: number; lastAt: number;
}

const prompt = '(r.input + r.cache_read + r.cache_write_5m + r.cache_write_1h)';
const sums = `r.provider AS provider, r.model AS model, r.speed AS speed,
  ${prompt} > 200000 AS over200k, ${prompt} > 272000 AS over272k, count(*) AS requests,
  sum(r.input) AS input, sum(r.cache_read) AS cacheRead, sum(r.cache_write_5m) AS cacheWrite5m,
  sum(r.cache_write_1h) AS cacheWrite1h, sum(r.output) AS output, sum(r.web_searches) AS webSearches, max(r.at) AS lastAt`;
const priceKeys = 'r.provider, r.model, r.speed, over200k, over272k';

export class Ledger {
  private readonly db: Database;
  constructor(db: Database) { this.db = db; }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  /**
   * Record requests and advance the file cursor in one transaction, so a crash never counts a chunk twice.
   * A request seen again keeps its larger copy: Claude Code rewrites lines as output streams in.
   */
  ingest(hostId: string, path: string,
    chunk: { cursor: FileCursor; records: readonly UsageRecord[]; turns?: readonly Turn[]; sessions?: Record<string, string> }) {
    const { cursor, records, turns = [], sessions = {} } = chunk;
    const turn = this.db.prepare('INSERT INTO turns VALUES (@key, @sessionId, @at) ON CONFLICT (key) DO NOTHING');
    const insert = this.db.prepare(`INSERT INTO requests VALUES (@key, @provider, @sessionId, @hostId, @at, @model, @input,
      @cacheRead, @cacheWrite5m, @cacheWrite1h, @output, @reasoning, @speed, @webSearches)
      ON CONFLICT (key) DO UPDATE SET input = excluded.input, cache_read = excluded.cache_read,
        cache_write_5m = excluded.cache_write_5m, cache_write_1h = excluded.cache_write_1h, output = excluded.output,
        reasoning = excluded.reasoning, speed = excluded.speed, web_searches = excluded.web_searches
      WHERE excluded.input + excluded.cache_read + excluded.cache_write_5m + excluded.cache_write_1h + excluded.output
        > requests.input + requests.cache_read + requests.cache_write_5m + requests.cache_write_1h + requests.output`);
    const file = this.db.prepare(`INSERT INTO files VALUES (@hostId, @path, @size, @offset, @context)
      ON CONFLICT (host_id, path) DO UPDATE SET size = excluded.size, offset = excluded.offset, context = excluded.context`);
    const info = this.db.prepare(`INSERT INTO session_info VALUES (@sessionId, @cwd) ON CONFLICT (session_id) DO NOTHING`);
    this.transaction(() => {
      for (const record of records) insert.run({ ...record, hostId });
      for (const [sessionId, cwd] of Object.entries(sessions)) info.run({ sessionId, cwd });
      for (const value of turns) turn.run({ key: value.key, sessionId: value.sessionId, at: value.at });
      file.run({ hostId, path, size: cursor.size, offset: cursor.offset, context: JSON.stringify(cursor.context) });
    });
  }

  cursors(hostId: string): Map<string, FileCursor> {
    const rows = this.db.prepare('SELECT path, size, offset, context FROM files WHERE host_id = @hostId').all({ hostId }) as
      { path: string; size: number; offset: number; context: string }[];
    return new Map(rows.map(row => [row.path, { size: row.size, offset: row.offset, context: JSON.parse(row.context) as FileContext }]));
  }

  mapThread(thread: ThreadInfo, sessionIds: readonly string[], at: number) {
    const session = this.db.prepare(`INSERT INTO sessions VALUES (@sessionId, @threadId)
      ON CONFLICT (session_id) DO UPDATE SET thread_id = excluded.thread_id`);
    const info = this.db.prepare(`INSERT INTO threads VALUES (@threadId, @title, @projectId, @provider, @at, @parentId)
      ON CONFLICT (thread_id) DO UPDATE SET title = excluded.title, project_id = excluded.project_id,
        provider = excluded.provider, mapped_at = excluded.mapped_at, parent_id = excluded.parent_id`);
    this.transaction(() => {
      info.run({ ...thread, at });
      for (const sessionId of sessionIds) session.run({ sessionId, threadId: thread.threadId });
    });
  }

  mappedAt(): Map<string, number> {
    const rows = this.db.prepare('SELECT thread_id AS threadId, mapped_at AS at FROM threads').all() as { threadId: string; at: number }[];
    return new Map(rows.map(row => [row.threadId, row.at]));
  }

  forgetThread(threadId: string) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM sessions WHERE thread_id = @threadId').run({ threadId });
      this.db.prepare('DELETE FROM threads WHERE thread_id = @threadId').run({ threadId });
    });
  }

  threadRows(threadId: string): UsageRow[] {
    return this.db.prepare(`SELECT NULL AS day, NULL AS threadId, NULL AS cwd, ${sums} FROM requests r
      JOIN sessions s ON s.session_id = r.session_id WHERE s.thread_id = @threadId GROUP BY ${priceKeys}`).all({ threadId }) as UsageRow[];
  }

  /** Rows per local day and thread since `from`. Requests outside any BB thread group by working directory instead. */
  rowsSince(from: number): UsageRow[] {
    return this.db.prepare(`SELECT date(r.at / 1000, 'unixepoch', 'localtime') AS day, s.thread_id AS threadId,
        CASE WHEN s.thread_id IS NULL THEN i.cwd END AS cwd, ${sums}
      FROM requests r LEFT JOIN sessions s ON s.session_id = r.session_id LEFT JOIN session_info i ON i.session_id = r.session_id
      WHERE r.at >= @from GROUP BY day, s.thread_id, cwd, ${priceKeys}`).all({ from }) as UsageRow[];
  }

  threads(threadIds: readonly string[]): Map<string, ThreadInfo> {
    const lookup = this.db.prepare(`SELECT thread_id AS threadId, title, project_id AS projectId, provider, parent_id AS parentId
      FROM threads WHERE thread_id = @threadId`);
    return new Map(threadIds.flatMap(threadId => {
      const row = lookup.get({ threadId }) as ThreadInfo | undefined;
      return row ? [[threadId, row] as const] : [];
    }));
  }

  /** Each mapped thread's parent, for folding sub-threads into the thread that started them. */
  parents(): Map<string, string> {
    const rows = this.db.prepare('SELECT thread_id AS threadId, parent_id AS parentId FROM threads WHERE parent_id IS NOT NULL').all() as
      { threadId: string; parentId: string }[];
    return new Map(rows.map(row => [row.threadId, row.parentId]));
  }

  /** Length measures per BB thread since `from`: requests, turns and the largest prompt any request sent. */
  lengths(from: number): Map<string, { requests: number; turns: number; peakContext: number }> {
    const result = new Map<string, { requests: number; turns: number; peakContext: number }>();
    const requests = this.db.prepare(`SELECT s.thread_id AS threadId, count(*) AS requests, max(${prompt}) AS peak FROM requests r
      JOIN sessions s ON s.session_id = r.session_id WHERE r.at >= @from GROUP BY s.thread_id`).all({ from }) as
      { threadId: string; requests: number; peak: number }[];
    for (const row of requests) result.set(row.threadId, { requests: row.requests, turns: 0, peakContext: row.peak });
    const turns = this.db.prepare(`SELECT s.thread_id AS threadId, count(*) AS turns FROM turns t
      JOIN sessions s ON s.session_id = t.session_id WHERE t.at >= @from GROUP BY s.thread_id`).all({ from }) as { threadId: string; turns: number }[];
    for (const row of turns) { const value = result.get(row.threadId); if (value) value.turns = row.turns; }
    return result;
  }

  /** A thread's requests in order, one row each, so each can be priced on its own. */
  threadRequests(threadId: string): UsageRow[] {
    return this.db.prepare(`SELECT NULL AS day, NULL AS threadId, NULL AS cwd, r.provider AS provider, r.model AS model, r.speed AS speed,
        ${prompt} > 200000 AS over200k, ${prompt} > 272000 AS over272k, 1 AS requests, r.input AS input, r.cache_read AS cacheRead,
        r.cache_write_5m AS cacheWrite5m, r.cache_write_1h AS cacheWrite1h, r.output AS output, r.web_searches AS webSearches, r.at AS lastAt
      FROM requests r JOIN sessions s ON s.session_id = r.session_id WHERE s.thread_id = @threadId ORDER BY r.at`).all({ threadId }) as UsageRow[];
  }

  prices(): { fetchedAt: number; cards: RateCards } | null {
    const row = this.db.prepare('SELECT fetched_at AS fetchedAt, cards FROM prices WHERE id = 1').get() as
      { fetchedAt: number; cards: string } | undefined;
    return row ? { fetchedAt: row.fetchedAt, cards: JSON.parse(row.cards) as RateCards } : null;
  }

  savePrices(fetchedAt: number, cards: RateCards) {
    this.db.prepare(`INSERT INTO prices VALUES (1, @fetchedAt, @cards)
      ON CONFLICT (id) DO UPDATE SET fetched_at = excluded.fetched_at, cards = excluded.cards`).run({ fetchedAt, cards: JSON.stringify(cards) });
  }

  counts() {
    return this.db.prepare(`SELECT (SELECT count(*) FROM requests) AS requests, (SELECT count(*) FROM files) AS files,
      (SELECT count(*) FROM threads) AS threads, (SELECT min(at) FROM requests) AS firstAt, (SELECT max(at) FROM requests) AS lastAt`)
      .get() as { requests: number; files: number; threads: number; firstAt: number | null; lastAt: number | null };
  }
}
