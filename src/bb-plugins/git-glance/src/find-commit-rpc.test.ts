import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';
import { rpcContract } from '../contracts.ts';

const sha = 'abcdef1234567890abcdef1234567890abcdef1234';
const source = (hostId: string, path: string) => ({ id: path, projectId: 'p', type: 'local_path' as const,
  hostId, path, isDefault: false, createdAt: 0, updatedAt: 0 });

function setup(matches: string[] = [], unchecked = 0) {
  const { bb, harness } = createFakePluginHost({
    sdk: {
      hosts: { experimental_discoverRepos: async () => ({ repos: [], truncated: false }) },
      threads: { get: async () => makeThreadResponse({ environmentId: 'env' }) },
      environments: {
        get: async () => ({ id: 'env', hostId: 'host', path: '/selected' }),
        list: async () => [{ hostId: 'host', path: '/worktree' }],
      },
      projects: { list: async () => [{ id: 'p', kind: 'standard', name: 'Example', gitRemoteUrl: null,
        sources: [source('host', '/project'), source('other', '/elsewhere'), source('host', '/selected')], createdAt: 0, updatedAt: 0 }] },
    },
    experimental_callHostRpc: async ({ method, input, hostId }) => {
      assert.equal(hostId, 'host');
      if (method === 'findCommit') {
        const { roots } = input as { roots: string[] };
        return { matches: roots.filter(root => matches.includes(root)).map(root => ({ root, sha })), unchecked };
      }
      if (method === 'checkout') return input;
      if (method === 'watch') return { kind: 'none' };
      return {};
    },
  });
  plugin(bb);
  const find = async () => rpcContract.findCommit.output.parse(await harness.behavior.callRpc('findCommit', { threadId: 't', sha: sha.slice(0, 7) }));
  return { bb, harness, find };
}

test('a match in the selected repository avoids cross-repository discovery', async () => {
  const { harness, find } = setup(['/selected', '/project']);
  try {
    assert.deepEqual(await find(), { hostId: 'host', matches: [{ root: '/selected', sha }], unchecked: 0 });
    assert.equal(harness.inspection.sdk.callsTo('projects.list').length, 0);
    assert.equal(harness.inspection.sdk.callsTo('hosts.experimental_discoverRepos').length, 0);
    assert.equal(harness.experimental_hostRpcCalls.length, 1);
  } finally { await harness.lifecycle.dispose(); }
});

const discovered = (path: string) => ({ path, name: 'Example', lastActivityAt: '2026-01-01T00:00:00.000Z', originUrl: null, projectId: null });

test('a known match avoids a filesystem discovery scan', async () => {
  const { harness, find } = setup(['/project']);
  try {
    assert.deepEqual((await find()).matches, [{ root: '/project', sha }]);
    assert.equal(harness.inspection.sdk.callsTo('hosts.experimental_discoverRepos').length, 0);
  } finally { await harness.lifecycle.dispose(); }
});

test('a complete miss discovers newly created repositories and retries only new paths', async () => {
  const { harness, find } = setup(['/new']);
  try {
    harness.inspection.sdk.stub('hosts.experimental_discoverRepos', async ({ hostId }) => {
      assert.equal(hostId, 'host');
      return { repos: [discovered('/project'), discovered('/new'), discovered('/new')], truncated: false };
    });
    assert.deepEqual(await find(), { hostId: 'host', matches: [{ root: '/new', sha }], unchecked: 0 });
    const searches = harness.experimental_hostRpcCalls.filter(call => call.method === 'findCommit');
    assert.deepEqual(searches.map(call => call.input), [
      { roots: ['/selected'], sha: sha.slice(0, 7) },
      { roots: ['/project', '/worktree'], sha: sha.slice(0, 7) },
      { roots: ['/new'], sha: sha.slice(0, 7) },
    ]);
    assert.equal(harness.inspection.sdk.callsTo('threads.update').length, 0);
  } finally { await harness.lifecycle.dispose(); }
});

test('each miss refreshes discovery so a repository created after an earlier click is found', async () => {
  const { harness, find } = setup(['/new']);
  let paths: string[] = [];
  try {
    harness.inspection.sdk.stub('hosts.experimental_discoverRepos', async () => ({ repos: paths.map(discovered), truncated: false }));
    assert.deepEqual((await find()).matches, []);
    paths = ['/new'];
    assert.deepEqual((await find()).matches, [{ root: '/new', sha }]);
    assert.equal(harness.inspection.sdk.callsTo('hosts.experimental_discoverRepos').length, 2);
  } finally { await harness.lifecycle.dispose(); }
});

test('discovery failure and truncation report incomplete coverage', async () => {
  const { harness, find } = setup(['/new']);
  try {
    harness.inspection.sdk.stub('hosts.experimental_discoverRepos', async () => { throw new Error('unavailable'); });
    assert.deepEqual(await find(), { hostId: 'host', matches: [], unchecked: 1 });
    harness.inspection.sdk.stub('hosts.experimental_discoverRepos', async () => ({ repos: [discovered('/new')], truncated: true }));
    assert.deepEqual(await find(), { hostId: 'host', matches: [{ root: '/new', sha }], unchecked: 1 });
  } finally { await harness.lifecycle.dispose(); }
});

test('discovery results beyond the search limit leave coverage incomplete', async () => {
  const { harness, find } = setup(['/new/199']);
  try {
    harness.inspection.sdk.stub('hosts.experimental_discoverRepos', async () => ({
      repos: Array.from({ length: 200 }, (_, i) => discovered(`/new/${i}`)), truncated: false,
    }));
    const result = await find();
    assert.deepEqual(result.matches, []);
    assert.equal(result.unchecked, 72);
    const last = harness.experimental_hostRpcCalls.at(-1);
    assert.ok(last);
    assert.equal((last.input as { roots: string[] }).roots.length, 128);
  } finally { await harness.lifecycle.dispose(); }
});

test('a miss searches same-host project sources, environments and private app-data paths after reload', async () => {
  const { bb, harness } = setup(['/visited', '/project', '/worktree']);
  let active = harness;
  try {
    await harness.behavior.callRpc('openCheckout', { threadId: 't', hostId: 'host', path: '/visited' });
    await harness.behavior.callRpc('select', { threadId: 't', path: null });
    assert.deepEqual(await bb.storage.kv.get('known-checkouts:host'), ['/selected', '/visited']);
    active = (await harness.lifecycle.reload(plugin)).harness;
    const result = rpcContract.findCommit.output.parse(await active.behavior.callRpc('findCommit', { threadId: 't', sha: sha.slice(0, 7) }));
    assert.deepEqual(result.matches.map(match => match.root), ['/visited', '/project', '/worktree']);
    const searches = active.experimental_hostRpcCalls.filter(call => call.method === 'findCommit');
    assert.deepEqual(searches.map(call => call.input), [
      { roots: ['/selected'], sha: sha.slice(0, 7) },
      { roots: ['/visited', '/project', '/worktree'], sha: sha.slice(0, 7) },
    ]);
    assert.equal(active.inspection.sdk.callsTo('threads.update').length, 0);
    assert.equal(rpcContract.watch.output.parse(await active.behavior.callRpc('watch', { threadId: 't', clientId: 'a' })).root, '/selected');
  } finally { await active.lifecycle.dispose(); }
});

test('unavailable discovery sources keep available matches and report incomplete coverage', async () => {
  const { harness, find } = setup(['/worktree']);
  try {
    harness.inspection.sdk.stub('projects.list', async () => { throw new Error('unavailable'); });
    const result = await find();
    assert.deepEqual(result.matches, [{ root: '/worktree', sha }]);
    assert.equal(result.unchecked, 1);
  } finally { await harness.lifecycle.dispose(); }
});

test('search and app-data lists stay bounded', async () => {
  const { bb, harness, find } = setup();
  try {
    for (let i = 0; i < 66; i++) await harness.behavior.callRpc('openCheckout', { threadId: 't', hostId: 'host', path: `/trees/${i}` });
    const paths = await bb.storage.kv.get<string[]>('known-checkouts:host');
    assert.equal(paths?.length, 64);
    assert.equal(paths?.[0], '/trees/65');
    harness.inspection.sdk.stub('environments.list', async () => Array.from({ length: 128 }, (_, i) => ({ hostId: 'host', path: `/env/${i}` })));
    assert.ok((await find()).unchecked > 0);
    const calls = harness.experimental_hostRpcCalls.filter(call => call.method === 'findCommit');
    const last = calls.at(-1);
    assert.ok(last);
    assert.equal((last.input as { roots: string[] }).roots.length, 128);
  } finally { await harness.lifecycle.dispose(); }
});
