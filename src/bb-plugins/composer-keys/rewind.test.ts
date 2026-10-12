import { expect, test } from 'vitest';
import { editedInput, promptsFromEvents } from './rewind.ts';

const requested = (seq: number, initiator: string, input: unknown[]) =>
  ({ seq, type: 'client/turn/requested', data: { initiator, input } });

test('keeps user prompts in order with their event sequence', () => {
  const prompts = promptsFromEvents([
    requested(9, 'user', [{ type: 'text', text: 'second', mentions: [] }]),
    { seq: 5, type: 'turn/started', data: {} },
    requested(4, 'user', [{ type: 'text', text: 'first', mentions: [] }, { type: 'image', path: '/a.png' }]),
    requested(7, 'agent', [{ type: 'text', text: 'from another thread', mentions: [] }]),
  ]);
  expect(prompts.map(p => [p.seq, p.text])).toEqual([[4, 'first'], [9, 'second']]);
});

test('unchanged text keeps mentions; edited text drops them but keeps attachments', () => {
  const [prompt] = promptsFromEvents([requested(3, 'user', [
    { type: 'text', text: 'see @thread', mentions: [{ start: 4, end: 11 }] },
    { type: 'image', path: '/a.png' },
  ])]);
  expect(editedInput(prompt!, 'see @thread')).toEqual(prompt!.input);
  expect(editedInput(prompt!, 'new text')).toEqual([
    { type: 'text', text: 'new text', mentions: [] },
    { type: 'image', path: '/a.png' },
  ]);
});
