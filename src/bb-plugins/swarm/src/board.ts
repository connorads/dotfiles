import { z } from 'zod';
import { isClosed, type Entry, type Member, type Swarm, type SwarmId, type ThreadId } from './domain.ts';

/** The part of a SQLite handle the board uses. better-sqlite3 and node:sqlite both fit. */
export interface Sql {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: (string | number | null)[]): unknown;
    get(...params: (string | number | null)[]): unknown;
    all(...params: (string | number | null)[]): unknown[];
  };
}

/** Append-only: a statement's index is its migration id. */
export const migrations = [
  `CREATE TABLE swarms (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    max_members INTEGER NOT NULL,
    max_wakes INTEGER NOT NULL,
    wakes INTEGER NOT NULL,
    stall_notice_at INTEGER,
    closed INTEGER NOT NULL
  )`,
  `CREATE TABLE entries (
    swarm_id TEXT NOT NULL REFERENCES swarms(id),
    seq INTEGER NOT NULL,
    at INTEGER NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (swarm_id, seq)
  )`,
  `CREATE TABLE members (
    swarm_id TEXT NOT NULL REFERENCES swarms(id),
    name TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL,
    run TEXT NOT NULL,
    cursor INTEGER NOT NULL,
    turn_start INTEGER NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (swarm_id, name)
  )`,
  `CREATE INDEX members_thread ON members (thread_id)`,
];

export interface Board {
  create(id: SwarmId, swarm: Swarm, at: number): void;
  load(id: SwarmId): Swarm | null;
  /** Persists the difference one decision made. */
  save(id: SwarmId, previous: Swarm, next: Swarm): void;
  /** The open swarm this thread is a live member of. A thread is in at most one. */
  openFor(threadId: ThreadId): SwarmId | null;
  open(): SwarmId[];
  /** The newest swarm this thread has been in, open or closed. */
  latestFor(threadId: ThreadId): SwarmId | null;
}

const name = z.string();
const entryBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('post'), author: name, text: z.string(), mentions: z.array(name) }),
  z.object({ kind: z.literal('joined'), member: name, brief: z.string() }),
  z.object({ kind: z.literal('reply'), member: name, text: z.string() }),
  z.object({ kind: z.literal('failed'), member: name, error: z.string() }),
  z.object({ kind: z.literal('left'), member: name }),
  z.object({ kind: z.literal('exhausted'), maxWakes: z.number() }),
  z.object({ kind: z.literal('closed'), summary: z.string() }),
]);
const entryRow = z.object({ seq: z.number(), at: z.number(), body: z.string() });
const memberRow = z.object({
  name,
  thread_id: z.string(),
  role: z.enum(['coordinator', 'worker']),
  run: z.enum(['working', 'idle', 'failed', 'stopped']),
  cursor: z.number(),
  turn_start: z.number(),
});
const idRow = z.object({ id: z.string() });
const swarmRow = z.object({
  max_members: z.number(),
  max_wakes: z.number(),
  wakes: z.number(),
  stall_notice_at: z.number().nullable(),
});

export function createBoard(db: Sql): Board {
  const transaction = (work: () => void) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      work();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const insertEntry = db.prepare('INSERT INTO entries (swarm_id, seq, at, body) VALUES (?, ?, ?, ?)');
  const upsertMember = db.prepare(
    `INSERT INTO members (swarm_id, name, thread_id, role, run, cursor, turn_start, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (swarm_id, name) DO UPDATE SET run = excluded.run, cursor = excluded.cursor, turn_start = excluded.turn_start`,
  );
  const writeMembers = (id: SwarmId, members: readonly Member[]) =>
    members.forEach((member, position) =>
      upsertMember.run(id, member.name, member.threadId, member.role, member.run, member.cursor, member.turnStart, position),
    );

  return {
    create(id, swarm, at) {
      transaction(() => {
        db.prepare('INSERT INTO swarms (id, created_at, max_members, max_wakes, wakes, stall_notice_at, closed) VALUES (?, ?, ?, ?, ?, ?, 0)')
          .run(id, at, swarm.limits.maxMembers, swarm.limits.maxWakes, swarm.wakes, swarm.stallNoticeAt);
        writeMembers(id, swarm.members);
      });
    },

    load(id) {
      const row = db.prepare('SELECT max_members, max_wakes, wakes, stall_notice_at FROM swarms WHERE id = ?').get(id);
      if (row === undefined) return null;
      const swarm = swarmRow.parse(row);
      const entries = db.prepare('SELECT seq, at, body FROM entries WHERE swarm_id = ? ORDER BY seq').all(id).map(raw => {
        const { seq, at, body } = entryRow.parse(raw);
        return { seq, at, ...entryBody.parse(JSON.parse(body)) } as Entry;
      });
      const members = db
        .prepare('SELECT name, thread_id, role, run, cursor, turn_start FROM members WHERE swarm_id = ? ORDER BY position')
        .all(id)
        .map(raw => {
          const member = memberRow.parse(raw);
          return { name: member.name, threadId: member.thread_id, role: member.role, run: member.run, cursor: member.cursor, turnStart: member.turn_start } as Member;
        });
      return {
        entries,
        members,
        limits: { maxMembers: swarm.max_members, maxWakes: swarm.max_wakes },
        wakes: swarm.wakes,
        stallNoticeAt: swarm.stall_notice_at,
      } as Swarm;
    },

    save(id, previous, next) {
      transaction(() => {
        for (const { seq, at, ...body } of next.entries.slice(previous.entries.length)) {
          insertEntry.run(id, seq, at, JSON.stringify(body));
        }
        writeMembers(id, next.members);
        db.prepare('UPDATE swarms SET wakes = ?, stall_notice_at = ?, closed = ? WHERE id = ?')
          .run(next.wakes, next.stallNoticeAt, isClosed(next) ? 1 : 0, id);
      });
    },

    openFor(threadId) {
      const row = db
        .prepare(
          `SELECT members.swarm_id AS id FROM members JOIN swarms ON swarms.id = members.swarm_id
           WHERE members.thread_id = ? AND members.run != 'stopped' AND swarms.closed = 0 LIMIT 1`,
        )
        .get(threadId);
      return row === undefined ? null : (idRow.parse(row).id as SwarmId);
    },

    latestFor(threadId) {
      const row = db
        .prepare(
          `SELECT members.swarm_id AS id FROM members JOIN swarms ON swarms.id = members.swarm_id
           WHERE members.thread_id = ? ORDER BY swarms.created_at DESC, swarms.rowid DESC LIMIT 1`,
        )
        .get(threadId);
      return row === undefined ? null : (idRow.parse(row).id as SwarmId);
    },

    open() {
      return db.prepare('SELECT id FROM swarms WHERE closed = 0 ORDER BY created_at').all().map(row => idRow.parse(row).id as SwarmId);
    },
  };
}
