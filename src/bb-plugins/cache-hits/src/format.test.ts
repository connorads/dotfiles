import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokens } from './format.ts';

test('token counts switch to millions once they pass 999.5k', () => {
  assert.deepEqual([999, 9_400, 168_250, 999_499, 999_500, 1_234_567, 37_530_865].map(tokens),
    ['999', '9.4k', '168k', '999k', '1.0M', '1.2M', '38M']);
});

test('token counts round up to the next unit without a stray decimal', () => {
  assert.deepEqual([9_949, 9_950, 9_999, 10_000].map(tokens), ['9.9k', '10k', '10k', '10k']);
});
