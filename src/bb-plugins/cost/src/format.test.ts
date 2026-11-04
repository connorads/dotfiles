import assert from 'node:assert/strict';
import { test } from 'node:test';
import { folder, niceTicks, usd, usdShort } from './format.ts';

test('axis ticks round up to clean steps', () => {
  assert.deepEqual(niceTicks(1830), [0, 500, 1000, 1500, 2000]);
  assert.deepEqual(niceTicks(9), [0, 2.5, 5, 7.5, 10]);
  assert.deepEqual(niceTicks(0), [0, 1]);
});

test('dollar amounts stay readable at every size', () => {
  assert.deepEqual([usd(0.004), usd(4.2), usd(12_706.97)], ['<$0.01', '$4.20', '$12,707']);
  assert.deepEqual([usdShort(950), usdShort(1500), usdShort(12_400), usdShort(0.4)], ['$950', '$1.5k', '$12k', '$0.40']);
  assert.equal(folder('/work/slay-the-agent/'), 'slay-the-agent');
});
