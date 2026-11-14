import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPick, parsePicks } from './recent-picks.ts';

test('a pick moves to the front without duplicates, capped at eight', () => {
  let picks = parsePicks(undefined);
  for (const path of ['a', 'b', 'c']) picks = addPick(picks, { path });
  picks = addPick(picks, { path: 'a' });
  assert.deepEqual(picks.map(pick => pick.path), ['a', 'c', 'b']);
  for (let index = 0; index < 10; index++) picks = addPick(picks, { path: `n${index}` });
  assert.equal(picks.length, 8);
  assert.equal(picks[0].path, 'n9');
});

test('a worktree pick is distinct from its repository pick', () => {
  const picks = addPick(addPick([], { path: 'app' }), { path: 'app', worktree: '/elsewhere/review' });
  assert.deepEqual(picks, [{ path: 'app', worktree: '/elsewhere/review' }, { path: 'app' }]);
});

test('malformed stored data reads as no picks', () => {
  assert.deepEqual(parsePicks([{ path: 42 }]), []);
  assert.deepEqual(parsePicks('nope'), []);
});
