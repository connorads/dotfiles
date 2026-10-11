import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph } from './graph.ts';

test('a linear history stays in one lane', () => {
  const rows = layoutGraph([{ sha: 'c', parents: ['b'] }, { sha: 'b', parents: ['a'] }, { sha: 'a', parents: [] }]);
  assert.deepEqual(rows.map(row => [row.lane, row.width, row.incoming.length, row.outgoing.length]),
    [[0, 1, 0, 1], [0, 1, 1, 1], [0, 1, 1, 0]]);
});

test('a merge opens a lane for the second parent and the fork point closes it', () => {
  // m merges f into main: m -> (b, f), f -> a, b -> a
  const rows = layoutGraph([
    { sha: 'm', parents: ['b', 'f'] },
    { sha: 'f', parents: ['a'] },
    { sha: 'b', parents: ['a'] },
    { sha: 'a', parents: [] },
  ]);
  assert.deepEqual(rows[0]!.outgoing, [{ from: 0, to: 0 }, { from: 0, to: 1 }]);
  assert.equal(rows[1]!.lane, 1);
  assert.deepEqual(rows[1]!.through, [0]);
  assert.equal(rows[2]!.lane, 0);
  assert.deepEqual(rows[2]!.through, [1]);
  // Both lanes expect a, so they converge into lane 0.
  assert.deepEqual(rows[3]!.incoming, [{ from: 0, to: 0 }, { from: 1, to: 0 }]);
  assert.equal(rows[3]!.width, 2);
});

test('unrelated tips get their own lanes', () => {
  const rows = layoutGraph([{ sha: 'x', parents: ['p'] }, { sha: 'y', parents: ['q'] }]);
  assert.deepEqual(rows.map(row => row.lane), [0, 1]);
  assert.deepEqual(rows[1]!.through, [0]);
});
