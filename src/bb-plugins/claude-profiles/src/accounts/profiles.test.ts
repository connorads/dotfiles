import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseProfileSession, transferProfileSession } from './profiles.ts';

const sessionId = '11111111-1111-4111-8111-111111111111';

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'claude-profiles-root-'));
  const root = join(home, '.claude-profiles', 'code');
  const defaultDir = join(home, '.claude');
  const summit = join(root, 'summit');
  const trove = join(root, 'trove');
  await mkdir(join(defaultDir, 'projects', 'workspace'), { recursive: true });
  await mkdir(join(summit, 'projects', 'workspace'), { recursive: true });
  await mkdir(join(trove, 'projects', 'workspace'), { recursive: true });
  return { home, root, defaultDir, summit, trove };
}

test('transfers and releases a session between live profiles under the configured root', async () => {
  const f = await fixture();
  const sourceFile = join(f.summit, 'projects', 'workspace', `${sessionId}.jsonl`);
  await writeFile(sourceFile, '{"type":"user","message":{"content":"hello"}}\n');
  const result = await transferProfileSession(
    { root: '~/.claude-profiles/code', sourceDir: f.summit, profileId: 'default', sessionId },
    f.home,
  );
  assert.deepEqual(result, { status: 'copied' });
  assert.equal(await readFile(join(f.defaultDir, 'projects', 'workspace', `${sessionId}.jsonl`), 'utf8'), '{"type":"user","message":{"content":"hello"}}\n');
  assert.deepEqual(
    await releaseProfileSession({ root: '~/.claude-profiles/code', sourceDir: f.summit, profileId: 'default', sessionId }, f.home),
    { released: true },
  );
});

test('names the missing profile when a deleted profile under the root cannot transfer history', async () => {
  const f = await fixture();
  const retired = join(f.root, 'retired');
  await assert.rejects(
    transferProfileSession({ root: '~/.claude-profiles/code', sourceDir: retired, profileId: 'default', sessionId }, f.home),
    /Source profile "retired" no longer exists on disk.*Restore it to .*\/retired/,
  );
});

test('allows rebinding from a deleted profile when the target already holds the session transcript', async () => {
  const f = await fixture();
  const retired = join(f.root, 'retired');
  await writeFile(join(f.defaultDir, 'projects', 'workspace', `${sessionId}.jsonl`), '{"type":"user","message":{"content":"kept"}}\n');
  assert.deepEqual(
    await transferProfileSession({ root: '~/.claude-profiles/code', sourceDir: retired, profileId: 'default', sessionId }, f.home),
    { status: 'copied' },
  );
  assert.deepEqual(
    await releaseProfileSession({ root: '~/.claude-profiles/code', sourceDir: retired, profileId: 'default', sessionId }, f.home),
    { released: false },
  );
});

test('keeps the outside-root error when sourceDir is outside the configured profile root', async () => {
  const f = await fixture();
  const outside = join(f.home, 'other-root', 'retired');
  await assert.rejects(
    transferProfileSession({ root: '~/.claude-profiles/code', sourceDir: outside, profileId: 'default', sessionId }, f.home),
    /Current profile is outside the configured profile root/,
  );
  const traversal = join(f.root, '..', 'retired');
  await assert.rejects(
    transferProfileSession({ root: '~/.claude-profiles/code', sourceDir: traversal, profileId: 'default', sessionId }, f.home),
    /Current profile is outside the configured profile root/,
  );
});

test('rejects a symlinked source directory under the configured root', async () => {
  const f = await fixture();
  const link = join(f.root, 'alias');
  await symlink(f.summit, link);
  await assert.rejects(
    transferProfileSession({ root: '~/.claude-profiles/code', sourceDir: link, profileId: 'default', sessionId }, f.home),
    /Current profile directory must be a real directory/,
  );
  await rm(f.home, { recursive: true, force: true });
});

test('allowMissing rebinds threads whose transcript already expired or whose profile folder is gone', async () => {
  const f = await fixture();
  const retired = join(f.root, 'retired');
  assert.deepEqual(
    await transferProfileSession({ root: '~/.claude-profiles/code', sourceDir: f.summit, profileId: 'default', sessionId, allowMissing: true }, f.home),
    { status: 'copied' },
  );
  assert.deepEqual(
    await releaseProfileSession({ root: '~/.claude-profiles/code', sourceDir: f.summit, profileId: 'default', sessionId }, f.home),
    { released: false },
  );
  assert.deepEqual(
    await transferProfileSession({ root: '~/.claude-profiles/code', sourceDir: retired, profileId: 'default', sessionId, allowMissing: true }, f.home),
    { status: 'copied' },
  );
  await rm(f.home, { recursive: true, force: true });
});
