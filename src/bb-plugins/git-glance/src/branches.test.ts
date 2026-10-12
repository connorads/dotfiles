import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGit as git, tempDir } from './test-git.ts';
import { listBranches, parseBranches, switchBranch } from './branches.ts';
import { resolveRepo } from './repo.ts';

const options = () => ({ signal: new AbortController().signal, timeoutMs: 20_000, onProgress: () => {} });

test('parse puts local branches first and drops remote branches already tracked', () => {
  const line = (...fields: string[]) => fields.join('\0');
  const output = [
    line('refs/heads/old', ' ', '', '', '100', 'old work'),
    line('refs/heads/main', '*', 'origin/main', 'ahead 2, behind 1', '300', 'latest'),
    line('refs/heads/dead', ' ', 'origin/dead', 'gone', '200', 'gone upstream'),
    line('refs/remotes/origin/HEAD', ' ', '', '', '300', 'latest'),
    line('refs/remotes/origin/main', ' ', '', '', '300', 'latest'),
    line('refs/remotes/origin/feature', ' ', '', '', '250', 'their feature'),
    line('refs/remotes/origin/old', ' ', '', '', '50', 'same name as a local branch'),
  ].join('\n');
  const branches = parseBranches(output);
  assert.deepEqual(branches.map(b => [b.kind, b.name]), [['local', 'main'], ['local', 'dead'], ['local', 'old'], ['remote', 'origin/feature']]);
  assert.deepEqual(branches[0], { name: 'main', kind: 'local', current: true, upstream: 'origin/main', ahead: 2, behind: 1, gone: false, time: 300, subject: 'latest' });
  assert.equal(branches[1]!.gone, true);
});

function setup() {
  const base = tempDir();
  git(base, 'init', '-q', '--bare', 'remote.git');
  const work = join(base, 'work');
  git(base, 'clone', '-q', 'remote.git', work);
  writeFileSync(join(work, 'f.txt'), 'base\n'); git(work, 'add', '.'); git(work, 'commit', '-qm', 'base');
  git(work, 'push', '-q', '-u', 'origin', 'main');
  git(work, 'switch', '-qc', 'topic'); writeFileSync(join(work, 'f.txt'), 'topic\n'); git(work, 'commit', '-qam', 'topic');
  git(work, 'push', '-q', 'origin', 'topic:shared');
  git(work, 'switch', '-q', 'main');
  return work;
}

test('switch moves between local branches and refuses to overwrite local edits', async () => {
  const work = setup();
  const repo = (await resolveRepo(work))!;
  assert.deepEqual((await listBranches(repo)).map(b => [b.kind, b.name, b.current]),
    [['local', 'main', true], ['local', 'topic', false], ['remote', 'origin/shared', false]]);
  assert.deepEqual(await switchBranch(repo, 'topic', false, options()), { ok: true, summary: 'Switched to topic' });
  assert.equal(git(work, 'branch', '--show-current').trim(), 'topic');
  writeFileSync(join(work, 'f.txt'), 'uncommitted\n');
  const refused = await switchBranch(repo, 'main', false, options());
  assert.equal(!refused.ok && refused.failure.reason, 'dirty');
  assert.equal(git(work, 'branch', '--show-current').trim(), 'topic');
});

test('switch can create a local branch tracking a remote one, and rejects option-like names', async () => {
  const work = setup();
  const repo = (await resolveRepo(work))!;
  assert.deepEqual(await switchBranch(repo, 'origin/shared', true, options()), { ok: true, summary: 'Switched to shared, tracking origin/shared' });
  assert.equal(git(work, 'rev-parse', '--abbrev-ref', '@{upstream}').trim(), 'origin/shared');
  const sneaky = await switchBranch(repo, '--orphan', false, options());
  assert.equal(sneaky.ok, false);
});
