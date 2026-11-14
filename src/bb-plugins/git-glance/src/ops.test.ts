import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refusedBy, start } from './ops.ts';

const fetching = start(null, { id: 'op_fetch', request: { kind: 'fetch' }, origin: 'auto', startedAt: 1 }, null)!;

test('a request refused for a running operation names that operation', () => {
  const stage = { kind: 'stage', path: 'README.md', area: 'unstaged' } as const;
  assert.equal(refusedBy(fetching, stage), fetching);
});

test('a started or already running identical request is not refused', () => {
  const discard = { kind: 'discard', path: 'notes/plan.md', area: 'unstaged' } as const;
  const started = start(null, { id: 'op_discard', request: { area: 'unstaged', path: 'notes/plan.md', kind: 'discard' }, origin: 'user', startedAt: 2 }, null);
  assert.equal(refusedBy(started, discard), null);
  assert.equal(refusedBy(fetching, { kind: 'fetch' }), null);
  assert.equal(refusedBy(null, discard), null);
});
