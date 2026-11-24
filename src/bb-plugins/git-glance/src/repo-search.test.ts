import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breadcrumbs, isDirectPath, joinPath, rankHostRepos, rankRepositories, shortenPath } from './repo-search.ts';

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

test('path helpers shorten home, build clickable breadcrumbs and detect direct paths', () => {
  const home = '/Users/alex';
  assert.equal(shortenPath('/Users/alex', home), '~');
  assert.equal(shortenPath('/Users/alex/src/app', home), '~/src/app');
  assert.equal(shortenPath('/Users/alexander', home), '/Users/alexander');
  assert.equal(joinPath('/Users/alex', 'src'), '/Users/alex/src');
  assert.equal(joinPath('/', 'Users'), '/Users');
  assert.equal(joinPath('/Users/alex', '/tmp/x'), '/tmp/x');
  assert.deepEqual(breadcrumbs('/Users/alex/src/app', home), [
    { label: '~', path: '/Users/alex' },
    { label: 'src', path: '/Users/alex/src' },
    { label: 'app', path: '/Users/alex/src/app' },
  ]);
  assert.deepEqual(breadcrumbs('/Users', home), [
    { label: '/', path: '/' },
    { label: 'Users', path: '/Users' },
  ]);
  assert.equal(isDirectPath('~'), true);
  assert.equal(isDirectPath('~/src'), true);
  assert.equal(isDirectPath('/Volumes/code'), true);
  assert.equal(isDirectPath('dotfiles'), false);
});

test('host repository ranking matches labels, paths and dotfiles ahead of path-only matches', () => {
  const home = '/Users/alex';
  const items = [
    { path: '/Users/alex', label: 'dotfiles', source: 'dotfiles' as const },
    { path: '/Users/alex/src/bb-plugins', label: 'BB Plugins', source: 'project' as const },
    { path: '/Users/alex/src/dot-notes', source: 'recent' as const },
  ];
  assert.deepEqual(rankHostRepos(items, 'dot', home).map(i => i.path), ['/Users/alex', '/Users/alex/src/dot-notes']);
  assert.deepEqual(rankHostRepos(items, 'bb', home).map(i => i.path), ['/Users/alex/src/bb-plugins']);
  assert.deepEqual(rankHostRepos(items, '~/src', home).map(i => i.path), ['/Users/alex/src/dot-notes', '/Users/alex/src/bb-plugins']);
});
