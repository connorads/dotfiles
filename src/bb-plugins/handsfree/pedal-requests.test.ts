import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serialisePedalRequests } from './pedal-requests.ts';

test('recording feedback finishes before the context request and failures do not block the queue', async () => {
  let rejectFirst: (error: Error) => void = () => {};
  const first = new Promise<never>((_, reject) => { rejectFirst = reject; });
  const calls: string[] = [];
  const request = serialisePedalRequests(async command => {
    calls.push(command.action);
    if (command.action === 'notice') return first;
    return { ok: true, message: 'Context available' };
  });
  const feedback = request({ action: 'notice', message: 'Recording' });
  const rejection = assert.rejects(feedback, /No focused window/);
  const context = request({ action: 'list', kind: 'thread' });
  await Promise.resolve();
  assert.deepEqual(calls, ['notice']);
  rejectFirst(Error('No focused window'));
  await rejection;
  assert.equal((await context).ok, true);
  assert.deepEqual(calls, ['notice', 'list']);
});
