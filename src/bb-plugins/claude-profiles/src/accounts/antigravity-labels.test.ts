import assert from 'node:assert/strict';
import test from 'node:test';
import { antigravityAccountLabel, parseAntigravityLabels } from './antigravity-labels.ts';

test('native and isolated accounts accept identity labels without changing their IDs', () => {
  const labels = parseAntigravityLabels('{"default":"first@example.com","secondary":"second@example.com"}');
  assert.equal(antigravityAccountLabel('default', 'Antigravity', labels), 'first@example.com');
  assert.equal(antigravityAccountLabel('secondary', 'Antigravity · Secondary', labels), 'second@example.com');
  assert.equal(antigravityAccountLabel('default', 'Antigravity', {}), 'Default');
  assert.equal(antigravityAccountLabel('secondary', 'Antigravity · Secondary', {}), 'Secondary');
});

test('invalid label configuration fails explicitly', () => {
  for (const value of ['no json', '[]', '{"default":" "}', '{"../other":"Name"}'])
    assert.throws(() => parseAntigravityLabels(value));
});
