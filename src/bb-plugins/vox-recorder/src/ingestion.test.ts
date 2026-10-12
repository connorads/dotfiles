import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDatabase } from './ingestion-test-db.ts';
import { completedTranscripts } from './ingestion-scan.ts';
import { digest, dispatch, IngestionLedger, revisionKey, type Candidate, type IngestionPorts } from './ingestion.ts';

const text = '[00:00:01] Me: Business call.\n';
const candidate: Candidate = { identity: 'host:directory-1', name: '2026-10-12-120000-call', path: '/store/call/transcript.md', hash: digest(text) };
function fixture() {
  const db = testDatabase();
  return { db, ledger: new IngestionLedger(db.database) };
}

test('baseline skips historical calls once; new revisions survive a reload', async () => {
  const { db, ledger } = fixture();
  ledger.baseline('host', [candidate]);
  assert.equal(ledger.get(revisionKey(candidate))?.state, 'skipped');
  const next = { ...candidate, hash: digest(text + 'Updated') };
  ledger.baseline('host', [next]);
  assert.equal(ledger.get(revisionKey(next)), undefined);
  ledger.freeze(next, text + 'Updated');
  const reopened = new IngestionLedger(db.database);
  assert.equal(reopened.get(revisionKey(next))?.text, text + 'Updated');
  db.close();
});

test('duplicate notifications freeze once and distinct recordings with identical words stay distinct', async () => {
  const { db, ledger } = fixture();
  ledger.freeze(candidate, text);
  ledger.freeze(candidate, text);
  ledger.freeze({ ...candidate, identity: 'host:directory-2' }, text);
  assert.equal(ledger.list().length, 2);
  assert.equal(ledger.freeze({ ...candidate, hash: digest('new') }, text), undefined);
  db.close();
});

test('ambiguous spawn is adopted after restart without dispatching again', async () => {
  const { db, ledger } = fixture();
  const row = ledger.freeze(candidate, text);
  assert.ok(row);
  let calls = 0;
  const ports: IngestionPorts = {
    spawn: async () => { calls++; throw new Error('lost response after creating thread'); },
    send: async () => { throw new Error('unexpected send'); },
    findThread: async () => 'thread-created',
  };
  await dispatch(ledger, ports, row);
  const uncertain = ledger.get(row.key);
  assert.equal(uncertain?.state, 'uncertain');
  assert.ok(uncertain);
  await dispatch(ledger, ports, uncertain);
  assert.equal(calls, 1);
  assert.equal(ledger.get(row.key)?.threadId, 'thread-created');
  assert.equal(ledger.get(row.key)?.state, 'spawned');
  db.close();
});

test('an unresolved dispatch stays uncertain and never creates another thread', async () => {
  const { db, ledger } = fixture();
  const row = ledger.freeze(candidate, text);
  assert.ok(row);
  ledger.save({ ...row, state: 'dispatching' });
  let calls = 0;
  const ports: IngestionPorts = { findThread: async () => null, spawn: async () => { calls++; return 'wrong'; }, send: async () => { calls++; } };
  await dispatch(ledger, ports, { ...row, state: 'dispatching' });
  assert.equal(calls, 0);
  assert.equal(ledger.get(row.key)?.state, 'uncertain');
  db.close();
});

test('retranscription reuses its thread and an early completion stays completed', async () => {
  const { db, ledger } = fixture();
  const row = ledger.freeze(candidate, text);
  assert.ok(row);
  const ports: IngestionPorts = {
    findThread: async () => null,
    spawn: async () => { ledger.save({ ...row, threadId: 'thread-one', state: 'succeeded' }); return 'thread-one'; },
    send: async (threadId, update) => { assert.equal(threadId, 'thread-one'); ledger.save({ ...update, state: 'skipped' }); },
  };
  await dispatch(ledger, ports, row);
  assert.equal(ledger.get(row.key)?.state, 'succeeded');
  const next = ledger.freeze({ ...candidate, hash: digest('revised') }, 'revised');
  assert.ok(next);
  assert.equal(next.threadId, 'thread-one');
  await dispatch(ledger, ports, next);
  assert.equal(ledger.get(next.key)?.state, 'skipped');
  db.close();
});

test('real store scan ignores temporary files, grabs, empty transcripts and live writers; identities survive rename', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vox-ingest-scan-'));
  const paths = { store: root, bin: '', statefile: join(root, 'state'), seenfile: join(root, 'seen') };
  const name = '2026-10-12-120000-call';
  const dir = join(root, name);
  await mkdir(dir);
  await writeFile(join(dir, '.transcript.tmp'), text);
  await writeFile(join(dir, 'grab.md'), text);
  assert.deepEqual(await completedTranscripts(paths, () => true), []);
  await writeFile(join(dir, 'transcript.md'), '');
  assert.deepEqual(await completedTranscripts(paths, () => true), []);
  await writeFile(join(dir, 'transcript.md'), text);
  await writeFile(join(dir, 'transcribing.pid'), '123 100');
  assert.deepEqual(await completedTranscripts(paths, () => true), []);
  const first = await completedTranscripts(paths, () => false);
  assert.equal(first.length, 1);
  await rename(dir, join(root, name + '-renamed'));
  const renamed = await completedTranscripts(paths, () => false);
  assert.equal(renamed[0]?.identity, first[0]?.identity);
  assert.equal(renamed[0]?.hash, first[0]?.hash);
  await writeFile(paths.statefile, `456 100 ${join(root, name + '-renamed')}`);
  assert.deepEqual(await completedTranscripts(paths, () => true), []);
});
