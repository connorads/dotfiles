import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entry } from './domain.ts';
import { formatEntry, segments, summarise, type BoardView } from './format.ts';

test('segments marks mentions and entry references, and nothing inside a word', () => {
  assert.deepEqual(segments('@scout see #12, mail a@b.c'), [
    { text: '@scout', mark: true },
    { text: ' see ', mark: false },
    { text: '#12', mark: true },
    { text: ', mail a@b.c', mark: false },
  ]);
  assert.deepEqual(segments('plain'), [{ text: 'plain', mark: false }]);
});

test('summarise counts live states and names a closed swarm', () => {
  const member = (name: string, run: BoardView['members'][number]['run']) => ({ name, role: 'worker' as const, run, threadId: name });
  const board: BoardView = { id: 's', closed: false, entries: [], members: [member('a', 'working'), member('b', 'working'), member('c', 'idle'), member('d', 'stopped')] };
  assert.equal(summarise(board), '2 working · 1 idle');
  assert.equal(summarise({ ...board, members: [member('a', 'failed')] }), '1 failed');
  assert.equal(summarise({ ...board, closed: true }), 'closed');
});

test('a board listing shortens a long brief', () => {
  const joined = { seq: 1, at: 0, kind: 'joined', member: 'scout', brief: 'b'.repeat(500) } as Entry;
  assert.equal(formatEntry(joined), `#1 engine: scout joined. Brief: ${'b'.repeat(160)}…`);
  assert.equal(formatEntry({ ...joined, brief: 'map the notes' } as Entry), '#1 engine: scout joined. Brief: map the notes');
});
