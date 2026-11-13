import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignKeys } from './keys.ts';

const profile = (id: string, label = id) => ({ id, label });

test('each account takes the first free letter of its name', () => {
  const { keys } = assignKeys({}, [profile('default', 'Default'), profile('summit', 'Summit'), profile('studio', 'Studio'), profile('trove', 'Trove')]);
  assert.deepEqual(keys, { default: 'D', summit: 'S', studio: 'T', trove: 'R' });
});

test('saved letters never move when an account is added', () => {
  const first = assignKeys({}, [profile('summit', 'Summit'), profile('trove', 'Trove')]);
  const { keys, changed } = assignKeys(first.keys, [profile('studio', 'Studio'), profile('summit', 'Summit'), profile('trove', 'Trove')]);
  assert.deepEqual(keys, { summit: 'S', trove: 'T', studio: 'U' });
  assert.equal(changed, true);
});

test('an unchanged list reports no change', () => {
  const first = assignKeys({}, [profile('summit', 'Summit')]);
  assert.equal(assignKeys(first.keys, [profile('summit', 'Summit')]).changed, false);
});

test('a name with no free letter takes the first free letter of the alphabet', () => {
  const { keys } = assignKeys({ a: 'A', b: 'B' }, [profile('a'), profile('b'), profile('ab', 'ab')]);
  assert.equal(keys.ab, 'C');
});

test('letters are single uppercase A-Z, ignoring digits and symbols in names', () => {
  const { keys } = assignKeys({}, [profile('x1', '1-x')]);
  assert.equal(keys.x1, 'X');
});

test('corrupt saved entries are reassigned', () => {
  const { keys } = assignKeys({ summit: 'S', studio: 'S', trove: 'tt' }, [profile('summit', 'Summit'), profile('studio', 'Studio'), profile('trove', 'Trove')]);
  assert.deepEqual(keys, { summit: 'S', studio: 'T', trove: 'R' });
});
