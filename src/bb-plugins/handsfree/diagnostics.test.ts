import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeDiagnostics } from './diagnostics.ts';
const command = (outcome: unknown, at = 100) => ({ kind: 'command', timestamp_ms: at, heard: 'next thread', command: 'next_thread', outcome, context: 'bb' });
async function fixture() {
  const path = join(await mkdtemp(join(tmpdir(), 'voice-diagnostics-')), 'live.ndjson');
  return { path, read: makeDiagnostics(path) };
}
const lines = (...events: unknown[]) => events.map(event => JSON.stringify(event)).join('\n') + '\n';
test('missing log reports unavailable without inventing state', async () => {
  const { read } = await fixture();
  assert.deepEqual(await read(), { available: false, state: null, transcript: null, attempts: [] });
});
test('capture state and transcript distinguish ignored speech from failed commands', async () => {
  const { read, path } = await fixture();
  await writeFile(path, lines({ kind: 'state', timestamp_ms: 90, state: 'transcribing' },
    { kind: 'transcript', timestamp_ms: 95, phase: 'updated', latency_ms: 120, text: 'next thread' },
    command('ignored'), command({ failed: 'No focused BB window' }, 101), command('executed', 102)));
  const snapshot = await read();
  assert.equal(snapshot.state?.state, 'transcribing');
  assert.equal(snapshot.transcript?.text, 'next thread');
  assert.deepEqual(snapshot.attempts.map(row => [row.result, row.problem, row.unmatched]), [
    ['Unmatched speech', false, true], ['No focused BB window', true, false], ['Handler returned', false, false],
  ]);
});
test('partial and malformed records wait for completion without duplicates', async () => {
  const { read, path } = await fixture(); const event = JSON.stringify(command('executed'));
  await writeFile(path, 'invalid\n' + lines({ kind: 'unknown', timestamp_ms: 1 }) + event.slice(0, 20));
  assert.equal((await read()).attempts.length, 0);
  await appendFile(path, event.slice(20) + '\n');
  assert.equal((await read()).attempts.length, 1);
  assert.equal((await read()).attempts.length, 1);
});
test('rotation and truncation replace activity; equal timestamps retain separate events', async () => {
  const { read, path } = await fixture();
  await writeFile(path, lines(command('executed'), command('ignored')));
  assert.equal((await read()).attempts.length, 2);
  await rename(path, path + '.old');
  await writeFile(path, lines({ kind: 'dictation', timestamp_ms: 200, phase: { failed: 'ASR unavailable' }, text: '' }));
  assert.equal((await read()).attempts[0]?.problem, true);
  await writeFile(path, ''); assert.equal((await read()).attempts.length, 0);
});
test('bounded tail skips split first line and retains fifty attempts', async () => {
  const { read, path } = await fixture();
  await writeFile(path, lines({ kind: 'unknown', text: 'x'.repeat(300_000) }, ...Array.from({ length: 80 }, (_, i) => command('executed', i))));
  const snapshot = await read(); assert.equal(snapshot.attempts.length, 50); assert.equal(snapshot.attempts[0]?.at, 30);
});
