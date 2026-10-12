import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';
import { rpcContract } from '../contracts.ts';

function setup() {
  const source = {
    id: 'source',
    hostId: 'remote-host',
    path: '/work/company',
    isDefault: true,
    projectId: 'project',
    type: 'local_path' as const,
    createdAt: 1,
    updatedAt: 1,
  };
  const project = {
    id: 'project',
    name: 'Company',
    kind: 'standard' as const,
    sources: [source],
    createdAt: 1,
    updatedAt: 1,
    gitRemoteUrl: null,
  };
  const documents = new Map([
    [
      '/work/company/TODO.md',
      '## Next\n- [ ] Acme: call Ben - [journal](engagements/acme/journal.md)\n',
    ],
    ['/work/company/engagements/acme/journal.md', '# Acme\nCall context\n'],
    ['/work/company/tasks.md', '- [ ] Different list\n'],
  ]);
  const { bb, harness } = createFakePluginHost({
    sdk: {
      projects: { get: async () => project, list: async () => [project] },
      files: {
        read: async (args) => {
          assert.equal(args.hostId, 'remote-host');
          assert.equal(args.rootPath, '/work/company');
          const content = documents.get(args.path);
          if (content === undefined) throw new Error('File missing');
          return {
            content,
            contentEncoding: 'utf8',
            sha256: 'a'.repeat(64),
            sizeBytes: Buffer.byteLength(content),
          };
        },
      },
    },
  });
  plugin(bb);
  return { harness, documents };
}
test('reads the selected checkout on its host, and refreshes actual task content', async () => {
  const { harness, documents } = setup();
  try {
    const input = { projectId: 'project', sourceId: null };
    const first = rpcContract.snapshot.output.parse(
      await harness.behavior.callRpc('snapshot', input),
    );
    assert.equal(first.tasks[0]?.title, 'call Ben');
    documents.set(
      '/work/company/TODO.md',
      '## Waiting\n- [ ] Acme: await response\n',
    );
    const next = rpcContract.snapshot.output.parse(
      await harness.behavior.callRpc('snapshot', input),
    );
    assert.equal(next.tasks[0]?.state, 'waiting');
    assert.equal(next.tasks[0]?.title, 'await response');
    assert.equal(harness.inspection.sdk.callsTo('files.write').length, 0);
  } finally {
    await harness.lifecycle.dispose();
  }
});
test('source selection changes only plugin configuration, and rejects escaping paths', async () => {
  const { harness } = setup();
  try {
    await assert.rejects(
      harness.behavior.callRpc('configure', {
        projectId: 'project',
        taskFile: '../other.md',
      }),
    );
    await harness.behavior.callRpc('configure', {
      projectId: 'project',
      taskFile: 'tasks.md',
    });
    const result = rpcContract.snapshot.output.parse(
      await harness.behavior.callRpc('snapshot', {
        projectId: 'project',
        sourceId: null,
      }),
    );
    assert.equal(result.tasks[0]?.title, 'Different list');
    assert.equal(result.taskFile, 'tasks.md');
    assert.equal(harness.inspection.sdk.callsTo('files.write').length, 0);
  } finally {
    await harness.lifecycle.dispose();
  }
});
test('context must be linked by the current task; arbitrary documents remain unread', async () => {
  const { harness } = setup();
  try {
    const input = {
      projectId: 'project',
      sourceId: null,
      taskId: 'TODO.md:2',
      path: 'engagements/acme/journal.md',
    };
    const result = rpcContract.context.output.parse(
      await harness.behavior.callRpc('context', input),
    );
    assert.match(result.content, /Call context/);
    await assert.rejects(
      harness.behavior.callRpc('context', { ...input, path: 'tasks.md' }),
    );
    await assert.rejects(
      harness.behavior.callRpc('context', { ...input, path: '../other.md' }),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
test('missing sources report an error rather than suggesting no tasks remain', async () => {
  const { harness, documents } = setup();
  try {
    documents.delete('/work/company/TODO.md');
    const result = rpcContract.snapshot.output.parse(
      await harness.behavior.callRpc('snapshot', {
        projectId: 'project',
        sourceId: null,
      }),
    );
    assert.match(result.error ?? '', /Could not read TODO.md/);
    const invalid = rpcContract.snapshot.output.parse(
      await harness.behavior.callRpc('snapshot', {
        projectId: 'project',
        sourceId: 'unknown',
      }),
    );
    assert.match(invalid.error ?? '', /no checkout/);
  } finally {
    await harness.lifecycle.dispose();
  }
});
