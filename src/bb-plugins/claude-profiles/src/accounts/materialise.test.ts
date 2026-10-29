import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materialise } from './materialise.ts';

test('materialising runs the host materialiser on the profile directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'materialise-'));
  const script = join(root, 'claude-profile-materialise');
  await writeFile(script, '#!/bin/sh\nprintf %s "$1" > "$1/marker"\n');
  await chmod(script, 0o755);
  assert.equal(await materialise(script, root), true);
  assert.equal(await readFile(join(root, 'marker'), 'utf8'), root);
});

test('a host without the materialiser skips it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'materialise-'));
  assert.equal(await materialise(join(root, 'missing'), root), false);
});

test('a failing materialiser reports the failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'materialise-'));
  const script = join(root, 'claude-profile-materialise');
  await writeFile(script, '#!/bin/sh\nexit 3\n');
  await chmod(script, 0o755);
  await assert.rejects(materialise(script, root));
});
