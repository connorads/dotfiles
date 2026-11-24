import assert from 'node:assert/strict';
import test from 'node:test';
import { segments } from './format.ts';

test('segments marks mentions and entry references, and nothing inside a word', () => {
  assert.deepEqual(segments('@scout see #12, mail a@b.c'), [
    { text: '@scout', mark: true },
    { text: ' see ', mark: false },
    { text: '#12', mark: true },
    { text: ', mail a@b.c', mark: false },
  ]);
  assert.deepEqual(segments('plain'), [{ text: 'plain', mark: false }]);
});
