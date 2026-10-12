import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterStart, interpret } from './outcome.ts';

test('success is exit 0 with a path on stdout', () => {
  assert.deepEqual(interpret({ code: 0, stdout: '/r/2026-01-01-000000\n', stderr: 'vox: recording\n' }, 'x'), { ok: true, path: '/r/2026-01-01-000000' });
});

test('a failed grab keeps its path and reports the last non-progress stderr line', () => {
  const run = { code: 1, stdout: '/tmp/vox-grab.1/grab.md\n', stderr: 'vox: transcribing the call so far…\nvox: no speech recognised in the call so far — see /tmp/vox.log\n' };
  assert.deepEqual(interpret(run, 'vox: grab failed'),
    { ok: false, path: '/tmp/vox-grab.1/grab.md', reason: 'vox: no speech recognised in the call so far — see /tmp/vox.log' });
});

test('a silent failure falls back to the given reason', () => {
  assert.deepEqual(interpret({ code: null, stdout: '', stderr: 'vox: working…\n' }, 'vox: start failed'), { ok: false, path: null, reason: 'vox: start failed' });
});

test('Enter keeps the recording and renames it only when titled', () => {
  const start = { ok: true as const, path: '/r/2026-01-01-000000/' };
  assert.deepEqual(afterStart(start, { kind: 'enter', title: '  kickoff ' }), { kind: 'rename', name: '2026-01-01-000000', title: 'kickoff' });
  assert.deepEqual(afterStart(start, { kind: 'enter', title: '' }), { kind: 'keep', name: '2026-01-01-000000' });
});

test('Esc discards, but a failed start is reported and never discarded', () => {
  assert.deepEqual(afterStart({ ok: true, path: '/r/2026-01-01-000000' }, { kind: 'escape' }), { kind: 'discard', name: '2026-01-01-000000' });
  assert.deepEqual(afterStart({ ok: false, path: '/r/old', reason: 'vox: already recording since 3m ago' }, { kind: 'escape' }),
    { kind: 'failed', reason: 'vox: already recording since 3m ago' });
});
