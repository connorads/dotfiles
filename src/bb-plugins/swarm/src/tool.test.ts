import assert from 'node:assert/strict';
import test from 'node:test';
import { route } from './tool.ts';

test('route maps each action to its use case and fills defaults', () => {
  assert.deepEqual(route({ action: 'add', name: 'scout', brief: 'map it' }), {
    action: 'add',
    request: { name: 'scout', brief: 'map it', provider: null, model: null },
  });
  assert.deepEqual(route({ action: 'post', text: '@scout go' }), { action: 'post', text: '@scout go' });
  assert.deepEqual(route({ action: 'read' }), { action: 'read', since: null });
  assert.deepEqual(route({ action: 'close', text: 'done' }), { action: 'close', summary: 'done' });
});

test('route refuses an action that lacks its fields', () => {
  assert.equal(route({ action: 'add', name: 'scout' }).action, 'invalid');
  assert.equal(route({ action: 'post' }).action, 'invalid');
});
