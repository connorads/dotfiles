import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, runDetached } from './run.ts';

/** A stand-in `vox` that follows the real contract: path on stdout, reason on stderr. */
async function fakeVox(body: string) {
  const dir = await mkdtemp(join(tmpdir(), 'vox-run-'));
  const bin = join(dir, 'vox');
  await writeFile(bin, `#!/bin/sh\n${body}\n`);
  await chmod(bin, 0o755);
  return { dir, bin };
}

test('run collects both streams and the exit code', async () => {
  const { bin } = await fakeVox('echo "args:$*"; echo "vox: no speech" >&2; exit 1');
  assert.deepEqual(await run(bin, ['grab', '5m'], { timeoutMs: 5_000 }), { code: 1, stdout: 'args:grab 5m\n', stderr: 'vox: no speech\n' });
});

test('run ends a hung child at the timeout', async () => {
  const { bin } = await fakeVox('sleep 30');
  const started = Date.now();
  const result = await run(bin, [], { timeoutMs: 200 });
  assert.equal(result.code, null);
  assert.ok(Date.now() - started < 5_000);
});

test('a missing binary reports why instead of throwing', async () => {
  const result = await run('/nonexistent/vox', [], { timeoutMs: 1_000 });
  assert.match(result.stderr, /ENOENT/);
});

test('a detached job reports its output on exit and cleans its log files', async () => {
  const { dir, bin } = await fakeVox('echo /r/2026-01-01-000000; echo "vox: done" >&2');
  const result = await runDetached(bin, ['stop'], { dir, id: 'job1' });
  assert.deepEqual(result, { code: 0, stdout: '/r/2026-01-01-000000\n', stderr: 'vox: done\n' });
  assert.deepEqual(await readdir(dir), ['vox']);
});

test('a detached job that cannot spawn still reports, with the reason', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vox-run-'));
  const result = await runDetached('/nonexistent/vox', ['stop'], { dir, id: 'job2' });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /ENOENT/);
});
