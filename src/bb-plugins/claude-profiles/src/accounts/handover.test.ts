import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, writeFile, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transferSession } from './handover.ts';

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
test('copies empty session directories', async () => {
  const f = await fixture();
  await mkdir(join(f.source, 'projects', 'workspace', sessionId));
  await transferSession(f.source, f.target, sessionId);
  assert.equal(await readFile(f.destination, 'utf8'), await readFile(f.file, 'utf8'));
});

async function sidecar(profile: string, path: string, content: string) {
  const file = join(profile, 'projects', 'workspace', sessionId, path);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, content);
  return file;
}
test('copies children, metadata and tool results when parent history already matches', async () => {
  const f = await fixture();
  await transferSession(f.source, f.target, sessionId);
  const files = [
    ['subagents/agent-child.jsonl', '{"message":"child secret"}\n'],
    ['subagents/agent-child.meta.json', '{"agentType":"probe"}'],
    ['tool-results/output.txt', 'full output'],
  ];
  for (const [path, content] of files) await sidecar(f.source, path, content);
  await transferSession(f.source, f.target, sessionId);
  for (const [path, content] of files) {
    assert.equal(await readFile(join(f.target, 'projects', 'workspace', sessionId, path), 'utf8'), content);
  }
});
test('switching back fast-forwards child logs and includes new child files', async () => {
  const f = await fixture();
  const original = await sidecar(f.source, 'subagents/agent-child.jsonl', 'first\n');
  await transferSession(f.source, f.target, sessionId);
  await sidecar(f.target, 'subagents/agent-child.jsonl', 'first\nsecond\n');
  await sidecar(f.target, 'subagents/agent-new.jsonl', 'new child\n');
  await transferSession(f.target, f.source, sessionId);
  assert.equal(await readFile(original, 'utf8'), 'first\nsecond\n');
  assert.equal(await readFile(join(original, '..', 'agent-new.jsonl'), 'utf8'), 'new child\n');
});
test('child conflicts leave parent and other destination files untouched', async () => {
  const f = await fixture();
  await sidecar(f.source, 'subagents/agent-child.jsonl', 'source history\n');
  await sidecar(f.source, 'tool-results/new.txt', 'not published');
  const conflict = await sidecar(f.target, 'subagents/agent-child.jsonl', 'different history\n');
  await writeFile(f.destination, '{"message":"remember me"}\n');
  await writeFile(f.file, '{"message":"remember me"}\n{"message":"next"}\n');
  await assert.rejects(transferSession(f.source, f.target, sessionId), /diverged/);
  assert.equal(await readFile(conflict, 'utf8'), 'different history\n');
  assert.equal(await readFile(f.destination, 'utf8'), '{"message":"remember me"}\n');
  await assert.rejects(readFile(join(f.target, 'projects', 'workspace', sessionId, 'tool-results/new.txt')), { code: 'ENOENT' });
});
test('refuses differing opaque metadata', async () => {
  const f = await fixture();
  await sidecar(f.source, 'subagents/agent-child.meta.json', '{"agentType":"new"}');
  await sidecar(f.target, 'subagents/agent-child.meta.json', '{"agentType":"old"}');
  await assert.rejects(transferSession(f.source, f.target, sessionId), /diverged/);
  await assert.rejects(readFile(f.destination), { code: 'ENOENT' });
});
test('refuses target-only state instead of merging two branches', async () => {
  const f = await fixture();
  await sidecar(f.target, 'subagents/agent-target.jsonl', 'only at target\n');
  await assert.rejects(transferSession(f.source, f.target, sessionId), /diverged/);
});
test('refuses oversized files before publishing history', async () => {
  const f = await fixture();
  const large = await sidecar(f.source, 'tool-results/large.txt', '');
  await truncate(large, 64 * 1024 * 1024 + 1);
  await assert.rejects(transferSession(f.source, f.target, sessionId), /Unsupported session file/);
  await assert.rejects(readFile(f.destination), { code: 'ENOENT' });
});
test('rejects a source change during staging without publishing history', async t => {
  const f = await fixture();
  const open = fs.open;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof open>) => {
    if (String(args[0]).includes('.tmp/')) await writeFile(f.file, 'changed while staging\n');
    return open(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(transferSession(f.source, f.target, sessionId), /Source history changed/);
  await assert.rejects(readFile(f.destination), { code: 'ENOENT' });
  assert.deepEqual(await readdir(join(f.destination, '..')), []);
});
test('preserves a target change made during staging', async t => {
  const f = await fixture();
  const open = fs.open;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof open>) => {
    if (String(args[0]).includes('.tmp/')) await writeFile(f.destination, 'external writer\n');
    return open(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(transferSession(f.source, f.target, sessionId), /Target history changed/);
  assert.equal(await readFile(f.destination, 'utf8'), 'external writer\n');
});
test('rechecks the source before publishing the parent after child copies', async t => {
  const f = await fixture();
  await sidecar(f.source, 'subagents/agent-child.jsonl', 'child\n');
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof rename>) => {
    await rename(...args);
    await writeFile(f.file, 'source changed during publication\n');
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(transferSession(f.source, f.target, sessionId), /Source history changed/);
  await assert.rejects(readFile(f.destination), { code: 'ENOENT' });
});
test('retries an interrupted child transfer with parent history published last', async t => {
  const f = await fixture();
  await sidecar(f.source, 'subagents/agent-a.jsonl', 'first child\n');
  await sidecar(f.source, 'subagents/agent-b.jsonl', 'second child\n');
  const rename = fs.rename;
  let calls = 0;
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof rename>) => {
    if (++calls === 2) throw new Error('simulated disk failure');
    return rename(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(transferSession(f.source, f.target, sessionId), /simulated disk failure/);
  await assert.rejects(readFile(f.destination), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.destination, '..', sessionId, 'subagents/agent-a.jsonl'), 'utf8'), 'first child\n');
  t.mock.restoreAll();
  syncBuiltinESMExports();
  await transferSession(f.source, f.target, sessionId);
  assert.equal(await readFile(f.destination, 'utf8'), await readFile(f.file, 'utf8'));
  assert.equal(await readFile(join(f.destination, '..', sessionId, 'subagents/agent-b.jsonl'), 'utf8'), 'second child\n');
  assert.equal((await readdir(join(f.destination, '..'))).some(name => name.endsWith('.tmp')), false);
});
for (const location of ['source', 'target'] as const) {
  test(`refuses symlinked ${location} session directories`, async () => {
    const f = await fixture();
    const project = join(f[location], 'projects', 'workspace');
    await mkdir(project, { recursive: true });
    await symlink(join(f.source, 'projects'), join(project, sessionId));
    await assert.rejects(transferSession(f.source, f.target, sessionId), /symlink/);
  });
  test(`refuses nested ${location} symlinks without publishing parent history`, async () => {
    const f = await fixture();
    const file = await sidecar(f[location], 'subagents/placeholder', 'fixture');
    await symlink(f.file, join(file, '..', 'agent-link.jsonl'));
    await assert.rejects(transferSession(f.source, f.target, sessionId), /symlink/);
    await assert.rejects(readFile(f.destination), { code: 'ENOENT' });
  });
}
