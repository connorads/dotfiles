import type { FileContext, Provider, Speed, UsageRecord } from './records.ts';
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
];

export interface FileCursor { size: number; offset: number; context: FileContext }
export interface ThreadInfo { threadId: string; title: string; projectId: string | null; provider: string }

/** Token sums for requests sharing a price: model, speed and context tier, plus the grouping keys asked for. */
export interface UsageRow {
  day: string | null; provider: Provider; model: string; threadId: string | null; speed: Speed;
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
  ingest(hostId: string, path: string, cursor: FileCursor, records: readonly UsageRecord[]) {
    const insert = this.db.prepare(`INSERT INTO requests VALUES (@key, @provider, @sessionId, @hostId, @at, @model, @input,
      @cacheRead, @cacheWrite5m, @cacheWrite1h, @output, @reasoning, @speed, @webSearches)
      ON CONFLICT (key) DO UPDATE SET input = excluded.input, cache_read = excluded.cache_read,
        cache_write_5m = excluded.cache_write_5m, cache_write_1h = excluded.cache_write_1h, output = excluded.output,
        reasoning = excluded.reasoning, speed = excluded.speed, web_searches = excluded.web_searches
      WHERE excluded.input + excluded.cache_read + excluded.cache_write_5m + excluded.cache_write_1h + excluded.output
        > requests.input + requests.cache_read + requests.cache_write_5m + requests.cache_write_1h + requests.output`);
    const file = this.db.prepare(`INSERT INTO files VALUES (@hostId, @path, @size, @offset, @context)
      ON CONFLICT (host_id, path) DO UPDATE SET size = excluded.size, offset = excluded.offset, context = excluded.context`);
    this.transaction(() => {
      for (const record of records) insert.run({ ...record, hostId });
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
    const info = this.db.prepare(`INSERT INTO threads VALUES (@threadId, @title, @projectId, @provider, @at)
      ON CONFLICT (thread_id) DO UPDATE SET title = excluded.title, project_id = excluded.project_id,
        provider = excluded.provider, mapped_at = excluded.mapped_at`);
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
    return this.db.prepare(`SELECT NULL AS day, NULL AS threadId, ${sums} FROM requests r
      JOIN sessions s ON s.session_id = r.session_id WHERE s.thread_id = @threadId GROUP BY ${priceKeys}`).all({ threadId }) as UsageRow[];
  }

  /** Rows per local day and thread since `from`. Requests outside any BB thread have a null thread. */
  rowsSince(from: number): UsageRow[] {
    return this.db.prepare(`SELECT date(r.at / 1000, 'unixepoch', 'localtime') AS day, s.thread_id AS threadId, ${sums}
      FROM requests r LEFT JOIN sessions s ON s.session_id = r.session_id WHERE r.at >= @from
      GROUP BY day, s.thread_id, ${priceKeys}`).all({ from }) as UsageRow[];
  }

  threads(threadIds: readonly string[]): Map<string, ThreadInfo> {
    const lookup = this.db.prepare('SELECT thread_id AS threadId, title, project_id AS projectId, provider FROM threads WHERE thread_id = @threadId');
    return new Map(threadIds.flatMap(threadId => {
      const row = lookup.get({ threadId }) as ThreadInfo | undefined;
      return row ? [[threadId, row] as const] : [];
    }));
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
