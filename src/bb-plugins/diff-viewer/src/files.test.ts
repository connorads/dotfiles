import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareFiles, isLockfile, planLoad, type LoadBudget } from './files.ts';
import type { StatEntry } from './stat.ts';

test('lockfiles by name, suffix and lock-file pattern', () => {
  for (const path of ['pnpm-lock.yaml', 'web/package-lock.json', 'Cargo.lock', 'go.sum', 'flake.lock', 'x/custom.lock', 'composer-lock.json'])
    assert.ok(isLockfile(path), path);
  for (const path of ['lock.ts', 'src/locker.ts', 'docs/lockfile.md', 'package.json'])
    assert.ok(!isLockfile(path), path);
});

test('file-tree order: directories first, natural names, lockfiles last', () => {
  const paths = ['pnpm-lock.yaml', 'README.md', 'src/z.ts', 'src/lib/b.ts', 'a.ts', 'src/file10.ts', 'src/file2.ts', 'docs/x.md', 'src/lib/A.ts'];
  assert.deepEqual(paths.map(path => ({ path })).sort(compareFiles).map(f => f.path),
    ['docs/x.md', 'src/lib/A.ts', 'src/lib/b.ts', 'src/file2.ts', 'src/file10.ts', 'src/z.ts', 'a.ts', 'README.md', 'pnpm-lock.yaml']);
});

const entry = (path: string, changed: number | null, extra: Partial<StatEntry> = {}): StatEntry =>
  ({ path, oldPath: null, status: 'modified', additions: changed, deletions: changed === null ? null : 0, binary: false, untracked: false, ...extra });
const budget: LoadBudget = { largeLines: 100, largeBytes: 1000, totalLines: 150, untrackedFiles: 1 };

test('the first load reads small patches until the budget runs out', () => {
  const plan = planLoad([
    entry('a.ts', 80), entry('huge.ts', 101), entry('b.ts', 60), entry('c.ts', 20), entry('pnpm-lock.yaml', 5),
    entry('logo.png', null, { binary: true }), entry('new.md', null, { untracked: true }), entry('big.log', null, { untracked: true }),
    entry('more.md', null, { untracked: true }),
  ], new Map([['big.log', 5000]]), budget);
  assert.deepEqual(plan, [
    { kind: 'inline' },
    { kind: 'deferred', reason: 'large' },
    { kind: 'inline' },
    { kind: 'deferred', reason: 'budget' },
    { kind: 'deferred', reason: 'lockfile' },
    { kind: 'binary' },
    { kind: 'inline' },
    { kind: 'deferred', reason: 'large' },
    { kind: 'deferred', reason: 'budget' },
  ]);
});
