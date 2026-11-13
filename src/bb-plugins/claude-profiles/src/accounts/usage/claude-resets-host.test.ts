import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectClaudeResets, readClaudeResets } from './claude-resets-host.ts';

const body = { cedar_ember: { eligible: true, grants: [{ resets_left: 2, ends_at: '2099-01-01T00:00:00Z',
  type: 'full', gives_back_weekly: true, paused: false, usable_now: true }] } };

test('Claude reset reads isolate profile caches and honour collector freshness and backoff', async () => {
  const home = await mkdtemp(join(tmpdir(), 'bb-claude-resets-'));
  await mkdir(join(home, '.cache'));
  const path = join(home, '.cache/claude-usage-team.json');
  let runs = 0;
  const collect = async () => { runs++; await writeFile(path, JSON.stringify(body)); return true; };
  assert.partialDeepStrictEqual(await readClaudeResets(home, 'team', false, collect), { status: 'ok', groups: [{ count: 2 }] });
  await readClaudeResets(home, 'team', false, collect);
  assert.equal(runs, 1);
  assert.equal('message' in await readClaudeResets(home, 'team', true, async () => true), false);
  const old = new Date(Date.now() - 301_000);
  await utimes(path, old, old);
  assert.partialDeepStrictEqual(await readClaudeResets(home, 'team', false, async () => false),
    { status: 'ok', message: 'Reset refresh failed. Showing the cached reading.' });
  assert.equal((await readClaudeResets(home, 'default', false, async () => false)).status, 'unavailable');
  assert.partialDeepStrictEqual(await readClaudeResets(home, 'team', true, async () => true),
    { status: 'ok', message: 'Collector kept the cached reading. Refresh may be paused.' });
});

test('invalid profile names cannot launch collection or select cache paths', async () => {
  const reading = await readClaudeResets('/tmp', '../elsewhere', true, async () => { throw new Error('Must not run'); });
  assert.equal(reading.status, 'unavailable');
});

test('collection finds installed helpers without shell startup changing PATH and selects the named profile', async () => {
  const home = await mkdtemp(join(tmpdir(), 'bb-claude-collector-'));
  await mkdir(join(home, '.config/zsh/functions'), { recursive: true });
  await mkdir(join(home, '.local/bin'), { recursive: true });
  await mkdir(join(home, '.local/share/mise/shims'), { recursive: true });
  const output = join(home, 'collected');
  await writeFile(join(home, '.local/bin/reset-test-helper'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  await writeFile(join(home, '.local/share/mise/shims/reset-test-cli'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(join(home, '.config/zsh/functions/claude-usage'), `reset-test-cli && reset-test-helper "$@" > '${output}'\n`);
  await writeFile(join(home, '.zshenv'), 'export PATH=/usr/bin:/bin\n');
  const previous = process.env.ZDOTDIR;
  process.env.ZDOTDIR = home;
  try {
    assert.equal(await collectClaudeResets(home, 'team', new AbortController().signal), true);
    assert.equal(await readFile(output, 'utf8'), '--profile\nteam\n');
    assert.equal(await collectClaudeResets(home, 'default', new AbortController().signal), true);
    assert.equal(await readFile(output, 'utf8'), '\n');
  } finally {
    if (previous === undefined) delete process.env.ZDOTDIR;
    else process.env.ZDOTDIR = previous;
  }
});
