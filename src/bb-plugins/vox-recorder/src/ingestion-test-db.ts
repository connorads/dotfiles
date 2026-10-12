import { DatabaseSync } from 'node:sqlite';
import type { LedgerDatabase } from './ingestion.ts';

/** Real SQLite for tests, without enabling the SDK harness's native install script. */
export function testDatabase(path = ':memory:'): { database: LedgerDatabase; close(): void } {
  const db = new DatabaseSync(path);
  return {
    close: () => db.close(),
    database: {
      exec: sql => db.exec(sql),
      prepare: sql => {
        const statement = db.prepare(sql);
        return {
          all: () => statement.all(), get: key => statement.get(key),
          run: value => typeof value === 'string' ? statement.run(value) : statement.run({ ...value }),
        };
      },
      transaction: work => () => {
        db.exec('BEGIN');
        try { const result = work(); db.exec('COMMIT'); return result; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    },
  };
}
