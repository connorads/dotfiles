import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makePedalSession, type Recording } from './pedal-session.ts';

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
test('release before capture admission finishes once and dispatches speech', async () => {
  const admission = deferred<Recording>();
  const heard: string[] = [];
  let finishes = 0;
  const session = makePedalSession({ start: () => admission.promise, heard: async text => { heard.push(text); }, feedback: () => {} });
  session.start(); session.start();
  const finished = session.finish();
  admission.resolve({ finish: async () => { finishes++; return { transcript: 'next thread', durationMs: 1000 }; }, cancel: async () => {} });
  await finished;
  assert.equal(finishes, 1);
  assert.deepEqual(heard, ['next thread']);
  assert.equal(session.busy(), false);
});
test('focus loss during transcription prevents command execution', async () => {
  const transcript = deferred<{ transcript: string; durationMs: number }>();
  const heard: string[] = [];
  const session = makePedalSession({ start: async () => ({ finish: () => transcript.promise, cancel: async () => {} }), heard: async text => { heard.push(text); }, feedback: () => {} });
  session.start();
  const finished = session.finish();
  void session.cancel();
  transcript.resolve({ transcript: 'archive this thread', durationMs: 1000 });
  await finished;
  assert.deepEqual(heard, []);
});
test('cancel and failed finish release the capture and permit another recording', async () => {
  let cancels = 0;
  const feedback: string[] = [];
  const session = makePedalSession({ start: async () => ({ finish: async () => { throw Error('Microphone unavailable'); }, cancel: async () => { cancels++; } }), heard: async () => { assert.fail('Must not execute'); }, feedback: message => { feedback.push(message); } });
  session.start(); await session.cancel();
  session.start(); await session.finish();
  assert.equal(cancels, 2);
  assert.equal(session.busy(), false);
  assert.ok(feedback.includes('Microphone unavailable'));
});
test('recording deadline cancels instead of executing forgotten speech', async () => {
  const cancelled = deferred<void>();
  const session = makePedalSession({ start: async () => ({ finish: async () => { assert.fail('Must cancel'); }, cancel: async () => { cancelled.resolve(); } }), heard: async () => { assert.fail('Must not execute'); }, feedback: () => {} }, 1);
  session.start();
  await cancelled.promise;
  await session.cancel();
  assert.equal(session.busy(), false);
});
