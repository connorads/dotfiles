import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transferSession } from './session.ts';

const sessionId = '68fe2a7c-6970-42b4-a246-77aa535bd3ba';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'claude-profile-test-'));
  const source = join(root, 'source');
  const target = join(root, 'target');
  await mkdir(join(source, 'projects', 'workspace'), { recursive: true });
  await mkdir(target);
  const file = join(source, 'projects', 'workspace', `${sessionId}.jsonl`);
  await writeFile(file, '{"message":"remember me"}\n');
  await writeFile(join(source, '.credentials.json'), 'must remain separate');
  return { source, target, file, destination: join(target, 'projects', 'workspace', `${sessionId}.jsonl`) };
}
test('copies the native transcript, leaves source and credentials separate', async () => {
  const f = await fixture();
  await transferSession(f.source, f.target, sessionId);
  assert.equal(await readFile(f.destination, 'utf8'), await readFile(f.file, 'utf8'));
  await assert.rejects(readFile(join(f.target, '.credentials.json')), { code: 'ENOENT' });
});
test('switching back fast-forwards an older transcript', async () => {
  const f = await fixture();
  await transferSession(f.source, f.target, sessionId);
  await writeFile(f.destination, '{"message":"remember me"}\n{"message":"next turn"}\n');
  await transferSession(f.target, f.source, sessionId);
  assert.equal(await readFile(f.file, 'utf8'), await readFile(f.destination, 'utf8'));
});
test('refuses divergent target history without overwriting it', async () => {
  const f = await fixture();
  await transferSession(f.source, f.target, sessionId);
  await writeFile(f.destination, 'different history\n');
  await assert.rejects(transferSession(f.source, f.target, sessionId), /diverged/);
  assert.equal(await readFile(f.destination, 'utf8'), 'different history\n');
});
test('refuses symlinked transcript destinations', async () => {
  const f = await fixture();
  await mkdir(join(f.target, 'projects', 'workspace'), { recursive: true });
  await symlink(f.file, f.destination);
  await assert.rejects(transferSession(f.source, f.target, sessionId), /symlink/);
});
test('refuses path traversal and missing transcripts', async () => {
  const f = await fixture();
  await assert.rejects(transferSession(f.source, f.target, '../credentials'), /session ID/);
  await assert.rejects(transferSession(f.source, f.target, '11111111-1111-4111-8111-111111111111'), /not found/);
});
test('refuses subagent sidecars until continuation is supported', async () => {
  const f = await fixture();
  await mkdir(join(f.source, 'projects', 'workspace', sessionId));
  await assert.rejects(transferSession(f.source, f.target, sessionId), /subagent/);
  await assert.rejects(readFile(f.destination), { code: 'ENOENT' });
});
