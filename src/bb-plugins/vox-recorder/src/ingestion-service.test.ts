import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import { installIngestion } from './ingestion-service.ts';
import { digest, IngestionLedger, type Candidate } from './ingestion.ts';
import { testDatabase } from './ingestion-test-db.ts';

const initialText = '[00:00:01] Me: Test a business summary.\n';
async function fixture(historical = false) {
  const root = await mkdtemp(join(tmpdir(), 'vox-ingestion-service-'));
  const db = testDatabase(join(root, 'ledger.db'));
  let candidates: Candidate[] = historical ? [{ identity: 'directory-one', name: '2026-10-12-120000-test', path: '/store/test/transcript.md', hash: digest(initialText) }] : [];
  let text = initialText;
  let changed: () => Promise<void> = async () => {};
  let status: 'active' | 'idle' | 'error' = 'active';
  let subscribes = 0;
  const metadata = new Map<string, Record<string, unknown>>();
  const host = createFakePluginHost({
    pluginId: 'vox-recorder', settings: { ingestEnabled: true, ingestProject: 'project-klimble' },
    sdk: {
      subscribe: () => () => {},
      projects: { get: async () => ({ id: 'project-klimble', sources: [{ hostId: 'host-one', path: root, isDefault: true }] }) },
      threads: {
        spawn: async (value: unknown) => {
          const input = z.object({ pluginMetadata: z.record(z.string(), z.unknown()) }).parse(value);
          metadata.set('thread-one', input.pluginMetadata);
          return makeThreadResponse({ id: 'thread-one', projectId: 'project-klimble', status: 'active' });
        },
        get: async () => makeThreadResponse({ id: 'thread-one', projectId: 'project-klimble', status }),
        getPluginMetadata: async (value: unknown) => metadata.get(z.object({ threadId: z.string() }).parse(value).threadId) ?? {},
        updatePluginMetadata: async (value: unknown) => {
          const input = z.object({ threadId: z.string(), set: z.record(z.string(), z.unknown()) }).parse(value);
          metadata.set(input.threadId, input.set);
          return input.set;
        },
        unarchive: async () => makeThreadResponse({ id: 'thread-one' }),
        send: async () => ({}),
        list: async () => [makeThreadResponse({ id: 'thread-one' })],
      },
      files: { read: async (value: unknown) => {
        const { path } = z.object({ path: z.string() }).parse(value);
        return { content: await readFile(path, 'utf8') };
      } },
    },
  });
  installIngestion(host.bb, {
    hostId: async () => 'host-one', subscribe: async () => { subscribes++; },
    completed: async () => candidates,
    transcript: async () => ({ text }),
    onChange: listener => { changed = listener; },
  }, () => new IngestionLedger(db.database));
  const service = host.harness.runService('transcript-ingestion');
  await until(async () => subscribes > 0 && (await host.harness.runCli(['ingest', 'status'])).exitCode === 0);
  // Await the initial service reconciliation before publishing a new recording.
  await changed();
  return {
    ...host, root, metadata,
    publish: async (nextText = initialText) => {
      text = nextText;
      candidates = [{ identity: 'directory-one', name: '2026-10-12-120000-test', path: '/store/test/transcript.md', hash: digest(text) }];
      await changed();
    },
    notify: () => changed(),
    status: (next: typeof status) => { status = next; },
    rows: () => new IngestionLedger(db.database).list(),
    close: async () => { service.controller.abort(); await service.done; await host.harness.dispose(); db.close(); },
  };
}

async function until(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 3_000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('Service did not start');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('a store notification spawns one Klimble thread with frozen input and provenance', async () => {
  const f = await fixture();
  try {
    await Promise.all([f.publish(), f.notify(), f.notify()]);
    const calls = f.harness.sdk.callsTo('threads.spawn');
    assert.equal(calls.length, 1);
    const args = z.object({ projectId: z.string(), prompt: z.string(), environment: z.object({ workspace: z.object({ path: z.string() }) }) }).parse(calls[0]?.[0]);
    assert.equal(args.projectId, 'project-klimble');
    assert.equal(args.environment.workspace.path, f.root);
    assert.match(args.prompt, /Do not save anything in the personal KB vault/);
    assert.ok(args.prompt.includes(initialText));
    assert.equal(f.rows()[0]?.state, 'spawned');
  } finally { await f.close(); }
});

test('saving confirmation checks real Klimble files and rejects missing provenance or a different thread', async () => {
  const f = await fixture();
  try {
    await f.publish();
    const row = f.rows()[0];
    assert.ok(row);
    const result = { key: row.key, outcome: 'saved', paths: ['call.md'], commit: '1234567', message: 'Checks passed.' };
    await writeFile(join(f.root, 'call.md'), '# No provenance\n');
    await assert.rejects(f.harness.callAgentTool('vox_ingestion_complete', result, { projectId: 'project-klimble', threadId: 'thread-one' }), /transcript hash/);
    await writeFile(join(f.root, 'call.md'), '# Call\n\n' + row.hash);
    await assert.rejects(f.harness.callAgentTool('vox_ingestion_complete', result, { projectId: 'project-klimble', threadId: 'thread-wrong' }), /does not belong/);
    await assert.rejects(f.harness.callAgentTool('vox_ingestion_complete', { ...result, paths: ['../outside.md'] }, { projectId: 'project-klimble', threadId: 'thread-one' }), /inside Klimble/);
    await f.harness.callAgentTool('vox_ingestion_complete', result, { projectId: 'project-klimble', threadId: 'thread-one' });
    assert.equal(f.rows()[0]?.state, 'succeeded');
    await f.notify();
    assert.equal(f.harness.sdk.callsTo('threads.spawn').length, 1);
  } finally { await f.close(); }
});

test('an idle thread without saved-note confirmation fails; retry and retranscription reuse that thread', async () => {
  const f = await fixture();
  try {
    await f.publish();
    f.status('idle');
    await f.notify();
    const row = f.rows()[0];
    assert.equal(row?.state, 'failed');
    assert.ok(row);
    f.status('active');
    const retried = await f.harness.runCli(['ingest', 'retry', row.key]);
    assert.equal(retried.exitCode, 0);
    assert.equal(f.harness.sdk.callsTo('threads.spawn').length, 1);
    assert.equal(f.harness.sdk.callsTo('threads.send').length, 1);
    await f.harness.callAgentTool('vox_ingestion_complete', { key: row.key, outcome: 'skipped', message: 'No business content.' }, { projectId: 'project-klimble', threadId: 'thread-one' });
    await f.publish(initialText + '[00:00:02] Me: A revision.\n');
    assert.equal(f.harness.sdk.callsTo('threads.spawn').length, 1);
    assert.equal(f.harness.sdk.callsTo('threads.send').length, 2);
    assert.equal(f.rows()[1]?.state, 'spawned');
  } finally { await f.close(); }
});

test('disabling ingestion prevents new dispatches', async () => {
  const f = await fixture();
  try {
    await f.harness.setSettings({ ingestEnabled: false });
    await f.publish();
    assert.equal(f.harness.sdk.callsTo('threads.spawn').length, 0);
  } finally { await f.close(); }
});

test('historical calls stay skipped until explicitly run; repeated manual runs do not duplicate dispatch', async () => {
  const f = await fixture(true);
  try {
    assert.equal(f.rows()[0]?.state, 'skipped');
    assert.equal(f.harness.sdk.callsTo('threads.spawn').length, 0);
    const result = await f.harness.runCli(['ingest', 'run', '2026-10-12-120000-test']);
    assert.equal(result.exitCode, 0);
    assert.equal(f.rows()[0]?.text, initialText);
    assert.equal(f.rows()[0]?.state, 'spawned');
    await f.harness.runCli(['ingest', 'run', '2026-10-12-120000-test']);
    assert.equal(f.harness.sdk.callsTo('threads.spawn').length, 1);
  } finally { await f.close(); }
});
