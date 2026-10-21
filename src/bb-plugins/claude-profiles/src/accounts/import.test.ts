import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adoptSession, descendants, liveSession, locateSession } from './import.ts';

const source = '68fe2a7c-6970-42b4-a246-77aa535bd3ba';
const target = '258445a4-9818-4c5f-9cd4-41005913c5be';
const history = [
  JSON.stringify({ type: 'user', cwd: '/work/repo', sessionId: source, message: 'remember me' }),
  JSON.stringify({ type: 'ai-title', aiTitle: 'Older title', sessionId: source }),
  JSON.stringify({ type: 'ai-title', aiTitle: 'Plugin version', sessionId: source }),
  '{"torn',
].join('\n');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'claude-import-test-'));
  const profile = { id: 'alpha', dir: join(root, 'alpha') };
  const other = { id: 'default', dir: join(root, 'default') };
  const project = join(profile.dir, 'projects', '-work-repo');
  await mkdir(join(project, source, 'subagents'), { recursive: true });
  await mkdir(join(other.dir, 'projects'), { recursive: true });
  await writeFile(join(project, `${source}.jsonl`), history);
  await writeFile(join(project, source, 'subagents', `agent-${source}.jsonl`), `{"sessionId":"${source}"}\n`);
  return { profile, other, project };
}

test('locates a session by ID with its profile, working directory and latest title', async () => {
  const f = await fixture();
  assert.deepEqual(await locateSession([f.other, f.profile], source),
    { profileId: 'alpha', sessionId: source, cwd: '/work/repo', title: 'Plugin version' });
});
test('refuses an unknown session', async () => {
  const f = await fixture();
  await assert.rejects(locateSession([f.other, f.profile], target), /not found/);
});
test('finds the live session of a pane process across profiles', async () => {
  const f = await fixture();
  await mkdir(join(f.profile.dir, 'sessions'), { recursive: true });
  await writeFile(join(f.profile.dir, 'sessions', '4407.json'),
    JSON.stringify({ pid: 4407, sessionId: source, cwd: '/work/repo', name: 'alpha-9e', status: 'idle' }));
  assert.deepEqual(await liveSession([f.other, f.profile], [4406, 4407]),
    { profileId: 'alpha', sessionId: source, cwd: '/work/repo', name: 'alpha-9e', status: 'idle' });
  await assert.rejects(liveSession([f.other, f.profile], [1]), /No Claude session/);
});
test('collects a pane process and its descendants', () => {
  assert.deepEqual(descendants(10, ' 10 1\n 11 10\n 12 11\n 13 1\n 14 10\n'), [10, 11, 14, 12]);
});
test('adopts history into the new session with IDs rewritten and leaves the source unchanged', async () => {
  const f = await fixture();
  await writeFile(join(f.project, `${target}.jsonl`), '{"stub":true}\n');
  await adoptSession(f.profile.dir, source, target);
  assert.equal(await readFile(join(f.project, `${target}.jsonl`), 'utf8'), history.replaceAll(source, target));
  assert.equal(await readFile(join(f.project, target, 'subagents', `agent-${target}.jsonl`), 'utf8'), `{"sessionId":"${target}"}\n`);
  assert.equal(await readFile(join(f.project, `${source}.jsonl`), 'utf8'), history);
  assert.deepEqual((await readdir(f.project)).sort(), [source, `${source}.jsonl`, target, `${target}.jsonl`].sort());
});
test('refuses a new session in another project directory', async () => {
  const f = await fixture();
  await mkdir(join(f.profile.dir, 'projects', '-elsewhere'));
  await writeFile(join(f.profile.dir, 'projects', '-elsewhere', `${target}.jsonl`), '{"stub":true}\n');
  await assert.rejects(adoptSession(f.profile.dir, source, target), /another directory/);
});
test('refuses to merge into existing session files', async () => {
  const f = await fixture();
  await writeFile(join(f.project, `${target}.jsonl`), '{"stub":true}\n');
  await mkdir(join(f.project, target));
  await assert.rejects(adoptSession(f.profile.dir, source, target), /already has session files/);
  assert.equal(await readFile(join(f.project, `${target}.jsonl`), 'utf8'), '{"stub":true}\n');
});
