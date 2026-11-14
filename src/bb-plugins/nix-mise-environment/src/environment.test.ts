import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readLoginEnvironment, shape } from './environment.ts';

const HOME = '/Users/example';

test('puts user wrappers, then mise shims, first in PATH without duplicates', () => {
  const entries = shape({ PATH: `/opt/homebrew/bin:${HOME}/.local/share/mise/shims:${HOME}/.local/bin:/usr/bin:/usr/bin` }, HOME);
  assert.deepEqual(entries.find(e => e.name === 'PATH')?.value,
    `${HOME}/.local/bin:${HOME}/.local/share/mise/shims:/opt/homebrew/bin:/usr/bin`);
});

test('keeps only allowed variables', () => {
  const entries = shape({ PATH: '/usr/bin', NIX_PATH: 'nixpkgs=x', GITHUB_TOKEN: 'secret', EMPTY: '', EDITOR: '' }, HOME);
  assert.deepEqual(entries.map(e => e.name), ['PATH', 'NIX_PATH']);
});

test('follows MISE_DATA_DIR', () => {
  const entries = shape({ PATH: '/usr/bin', MISE_DATA_DIR: '/data/mise' }, HOME);
  assert.match(entries[0]!.value, /^\/Users\/example\/\.local\/bin:\/data\/mise\/shims:/);
});

test('this machine: a shaped login environment resolves node through mise shims', async () => {
  const home = homedir();
  const entries = shape(await readLoginEnvironment(home, userInfo().username), home);
  const env = Object.fromEntries(entries.map(e => [e.name, e.value]));
  const result = spawnSync('/bin/zsh', ['-f', '-c', 'command -v node'], { env, encoding: 'utf8' });
  assert.equal(result.stdout.trim(), join(home, '.local', 'share', 'mise', 'shims', 'node'));
});
