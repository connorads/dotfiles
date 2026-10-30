import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckout } from './checkout.ts';
import { run, type Run } from './process.ts';

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'clone-repository-')));
  const origin = join(root, 'origin');
  assert.equal((await run('git', ['init', '--bare', origin])).code, 0);
  let clones = 0;
  const localRun: Run = async (command, args, options) => {
    if (command === 'git' && args.includes('clone')) {
      clones++;
      const clone = await run(command, ['clone', '--', origin, args.at(-1) ?? ''], options);
      if (clone.code === 0) await run('git', ['-C', args.at(-1) ?? '', 'remote', 'set-url', 'origin', 'git@github.com:acme/atlas.git']);
      return clone;
    }
    return run(command, args, options);
  };
  return { root, checkout: createCheckout({ run: localRun, home: join(root, 'home') }), clones: () => clones };
}

test('clones once and reuses the matching checkout on retry', async () => {
  const f = await fixture();
  const destination = join(f.root, 'group', 'atlas');
  assert.deepEqual(await f.checkout.prepare('acme/atlas', destination), { ok: true, path: destination, reused: false });
  assert.deepEqual(await f.checkout.prepare('acme/atlas', destination), { ok: true, path: destination, reused: true });
  assert.equal(f.clones(), 1);
});

test('inspect is read-only and concurrent prepares clone once', async () => {
  const f = await fixture();
  const destination = join(f.root, 'atlas');
  assert.equal((await f.checkout.inspect('acme/atlas', destination)).ok, false);
  await assert.rejects(access(destination));
  const results = await Promise.all([f.checkout.prepare('acme/atlas', destination), f.checkout.prepare('acme/atlas', destination)]);
  assert.ok(results.every(result => result.ok));
  assert.equal(f.clones(), 1);
});

test('does not reuse another repository or an enclosing repository', async () => {
  const f = await fixture();
  const destination = join(f.root, 'atlas');
  await f.checkout.prepare('acme/atlas', destination);
  assert.equal((await f.checkout.prepare('other/atlas', destination)).ok, false);
  const subfolder = join(destination, 'nested');
  await mkdir(subfolder);
  assert.equal((await f.checkout.prepare('acme/atlas', subfolder)).ok, false);
  assert.equal(f.clones(), 1);
});

test('refuses occupied or empty folders without deleting their contents', async () => {
  const f = await fixture();
  for (const name of ['empty', 'occupied']) {
    const destination = join(f.root, name);
    await mkdir(destination);
    if (name === 'occupied') await writeFile(join(destination, 'keep.txt'), 'keep');
    assert.equal((await f.checkout.prepare('acme/atlas', destination)).ok, false);
    await access(destination);
  }
  await access(join(f.root, 'occupied', 'keep.txt'));
  assert.equal(f.clones(), 0);
});

test('rejects relative paths, home, root and invalid repository input', async () => {
  const f = await fixture();
  for (const path of ['relative/atlas', '/', join(f.root, 'home'), '~']) {
    assert.equal((await f.checkout.prepare('acme/atlas', path)).ok, false, path);
  }
  assert.equal((await f.checkout.prepare('acme/..', join(f.root, 'bad'))).ok, false);
  assert.equal(f.clones(), 0);
});
