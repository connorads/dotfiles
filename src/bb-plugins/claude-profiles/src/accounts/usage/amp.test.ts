import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectAmpUsage } from './amp.ts';

async function executable(body: string) {
  const root = await mkdtemp(join(tmpdir(), 'bb-amp-usage-'));
  const command = join(root, 'amp');
  await writeFile(command, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
  return command;
}

test('native usage text preserves provider lines and strips terminal controls', async () => {
  const command = await executable("[ \"$1\" = usage ] || exit 2\nprintf '\\033[32mProvider usage text\\033[0m\\nSecond line\\n'");
  const result = await collectAmpUsage(new AbortController().signal, command);
  assert.partialDeepStrictEqual(result, { status: 'ok', text: 'Provider usage text\nSecond line' });
  assert.ok(result.status === 'ok' && result.observedAt > 0);
});

test('a missing CLI reports the installation requirement', async () => {
  assert.deepEqual(await collectAmpUsage(new AbortController().signal, '/missing/bb-test-amp'),
    { status: 'unavailable', message: 'Amp CLI is not installed on this machine.' });
});

test('authentication failures report login without forwarding stderr', async () => {
  const command = await executable("printf 'You must be logged in to view usage. Run `amp login` first.\\n' >&2\nexit 1");
  assert.deepEqual(await collectAmpUsage(new AbortController().signal, command),
    { status: 'unavailable', message: 'Sign in with amp login on this machine.' });
});

test('failed collection does not display raw stderr or partial stdout', async () => {
  const command = await executable("printf 'Partial reading'\nprintf 'Private diagnostic' >&2\nexit 1");
  assert.deepEqual(await collectAmpUsage(new AbortController().signal, command),
    { status: 'unavailable', message: 'Amp usage could not be collected on this machine.' });
});

test('cancelled collection terminates a running command', async () => {
  const command = await executable('exec /bin/sleep 10');
  assert.deepEqual(await collectAmpUsage(AbortSignal.timeout(50), command),
    { status: 'unavailable', message: 'Amp usage collection timed out or was cancelled.' });
});

test('empty successful output is unavailable', async () => {
  const command = await executable('exit 0');
  assert.deepEqual(await collectAmpUsage(new AbortController().signal, command),
    { status: 'unavailable', message: 'Amp returned no usage reading.' });
});
