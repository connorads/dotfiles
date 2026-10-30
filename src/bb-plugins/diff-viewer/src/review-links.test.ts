import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReviewReference } from '../review-links.ts';

test('review references identify an exact host, path and comparison', () => {
  assert.deepEqual(parseReviewReference('git-review://host_test/work/review%20copy?scope=uncommitted'), {
    target: { hostId: 'host_test', path: '/work/review copy' }, scope: { kind: 'uncommitted' },
  });
  assert.deepEqual(parseReviewReference('git-review://host_test/work?scope=unpushed')?.scope, { kind: 'unpushed', commit: null });
  assert.deepEqual(parseReviewReference('git-review://host_test/work?scope=branch')?.scope, { kind: 'branch' });
});

test('ambiguous or malformed review references stay plain text', () => {
  for (const text of [
    'git-checkout://host_test/work', 'git-review://host_test/work',
    'git-review://host_test/work?scope=unknown', 'git-review://host_test/work?scope=branch&scope=unpushed',
    'git-review://host_test/work?scope=branch&extra=1', 'git-review://host_test/work?scope=branch#x',
    'git-review://host_test/work%0a?scope=branch', 'git-review://host_test/work%GG?scope=branch',
    'git-review://user@host_test/work?scope=branch', 'git-review://other/work?scope=branch',
  ]) assert.equal(parseReviewReference(text), null, text);
});
