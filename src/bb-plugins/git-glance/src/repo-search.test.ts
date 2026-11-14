import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankRepositories } from './repo-search.ts';

const paths = ['clients/acme/portal', 'clients/acme/portal-api', 'services/api', 'services/billing', 'tools/rapid', 'web'];

test('an empty query keeps every repository in path order', () => {
  assert.deepEqual(rankRepositories(paths, '  '), paths);
});

test('name matches rank above path matches, exact before prefix before substring', () => {
  assert.deepEqual(rankRepositories(paths, 'api'), ['services/api', 'tools/rapid', 'clients/acme/portal-api']);
  assert.deepEqual(rankRepositories(paths, 'acme'), ['clients/acme/portal', 'clients/acme/portal-api']);
});

test('every word must appear in the path, in any case', () => {
  assert.deepEqual(rankRepositories(paths, 'ACME api'), ['clients/acme/portal-api']);
  assert.deepEqual(rankRepositories(paths, 'nothing'), []);
});
