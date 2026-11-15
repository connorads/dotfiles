import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokens } from './format.ts';

test('token counts switch to millions once they pass 999.5k', () => {
  assert.deepEqual([999, 9_400, 168_250, 999_499, 999_500, 1_234_567, 37_530_865].map(tokens),
    ['999', '9.4k', '168k', '999k', '1.0M', '1.2M', '38M']);
});
