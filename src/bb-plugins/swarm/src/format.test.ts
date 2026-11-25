import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entry } from './domain.ts';
import { age, emphasiseMentions, preview, formatEntry, segments, summarise, type BoardView } from './format.ts';

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
  const member = (name: string, run: BoardView['members'][number]['run']) => ({ name, role: 'worker' as const, run, threadId: name, provider: null, model: null, reasoning: null, account: null });
  const board: BoardView = { id: 's', closed: false, wakes: 0, maxWakes: 40, entries: [], members: [member('a', 'working'), member('b', 'working'), member('c', 'idle'), member('d', 'stopped')] };
  assert.equal(summarise(board), '2 working · 1 idle');
  assert.equal(summarise({ ...board, members: [member('a', 'failed')] }), '1 failed');
  assert.equal(summarise({ ...board, closed: true }), 'closed');
});

test('a board listing shortens a long brief', () => {
  const joined = { seq: 1, at: 0, kind: 'joined', member: 'scout', brief: 'b'.repeat(500) } as Entry;
  assert.equal(formatEntry(joined), `#1 engine: scout joined. Brief: ${'b'.repeat(160)}…`);
  assert.equal(formatEntry({ ...joined, brief: 'map the notes' } as Entry), '#1 engine: scout joined. Brief: map the notes');
});

test('emphasiseMentions bolds mentions outside code only', () => {
  assert.equal(emphasiseMentions('@scout see `@critic go` and mail a@b.c'), '**@scout** see `@critic go` and mail a@b.c');
  assert.equal(emphasiseMentions('```\n@scout\n```\nthen @all'), '```\n@scout\n```\nthen **@all**');
});

test('age reads as a short relative time', () => {
  const now = 10_000_000;
  assert.deepEqual([0, 50, 600, 7200, 200_000].map(seconds => age(now - seconds * 1000, now)), ['now', '1m', '10m', '2h', '2d']);
});

test('preview flattens Markdown to one plain line', () => {
  assert.equal(preview('@coordinator done:\n\n### 1. **Hybrid** `apps`\n- see [the note](notes/x.md)\n```\ncode\n```'), '@coordinator done: 1. Hybrid apps see the note');
});
