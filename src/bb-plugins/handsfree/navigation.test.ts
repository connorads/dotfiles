import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationHistory } from './navigation.ts';

const a = { threadId: 'a', projectId: 'p' };
const b = { threadId: 'b', projectId: 'p' };
const draft = { threadId: null, projectId: 'other' };
test('back visits earlier threads and drafts without bouncing forward', () => {
  const history = createNavigationHistory(a);
  history.observe(b);
  history.observe(draft);
  assert.deepEqual(history.back(), b);
  history.observe(b);
  assert.deepEqual(history.back(), a);
  history.observe(a);
  assert.equal(history.back(), null);
});
test('a failed navigation retains its destination for retry', () => {
  const history = createNavigationHistory(a);
  history.observe(b);
  assert.deepEqual(history.back(), a);
  history.observe(b);
  assert.deepEqual(history.back(), a);
});
test('an unrelated navigation becomes a new history entry', () => {
  const history = createNavigationHistory(a);
  history.observe(b);
  history.back();
  history.observe(draft);
  assert.deepEqual(history.back(), b);
});
