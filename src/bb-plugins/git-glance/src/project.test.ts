import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';
import { projectSubject, rpcContract } from '../contracts.ts';

const source = (path: string, isDefault: boolean) =>
  ({ id: path, projectId: 'p', type: 'local_path' as const, hostId: 'mac', path, isDefault, createdAt: 0, updatedAt: 0 });

function setup(sources: ReturnType<typeof source>[]) {
  const roots: string[] = [];
  const { bb, harness } = createFakePluginHost({
    sdk: {
      threads: { get: async () => { throw new Error('a project subject has no thread'); } },
      projects: { get: async () => ({ id: 'p', kind: 'standard' as const, name: 'P', gitRemoteUrl: null, sources, createdAt: 0, updatedAt: 0 }) },
    },
    experimental_callHostRpc: async ({ method, input, hostId }) => {
      assert.equal(hostId, 'mac');
      roots.push((input as { root: string }).root);
      return method === 'watch' ? { kind: 'none' } : {};
    },
  });
  plugin(bb);
  const watch = () => harness.behavior.callRpc('watch', { threadId: projectSubject('p'), clientId: 'a' });
  return { watch, roots, dispose: () => harness.lifecycle.dispose() };
}

test('the New thread screen reads the picked project default checkout', async () => {
  const { watch, roots, dispose } = setup([source('/other', false), source('/default', true)]);
  try {
    assert.equal(rpcContract.watch.output.parse(await watch()).root, '/default');
    assert.deepEqual(roots, ['/default']);
  } finally { await dispose(); }
});

test('a project without a checkout has no repository', async () => {
  const { watch, dispose } = setup([]);
  try { assert.equal(rpcContract.watch.output.parse(await watch()).root, null); } finally { await dispose(); }
});
