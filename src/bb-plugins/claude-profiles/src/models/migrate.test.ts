import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLegacy } from './migrate.ts';

test('legacy favourites beyond nine saved are skipped with no free slot', () => {
  const existing = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, slot: i + 1, name: '', providerId: 'pi', model: `m${i}` }));
  const result = mergeLegacy(existing, [{ id: 'new', slot: 1, name: '', providerId: 'codex', model: 'gpt' }]);
  assert.deepEqual(result, { list: existing, imported: 0, skipped: [{ id: 'new', reason: 'no free slot' }] });
});
