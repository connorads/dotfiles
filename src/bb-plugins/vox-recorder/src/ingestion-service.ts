import { resolve, sep } from 'node:path';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { digest, dispatch, IngestionLedger, ingestionPrompt, revisionKey, type Candidate, type IngestionPorts } from './ingestion.ts';

interface HostPorts {
  hostId(): Promise<string>;
  subscribe(): Promise<unknown>;
  completed(): Promise<Candidate[]>;
  transcript(name: string): Promise<{ text: string }>;
  onChange(listener: () => Promise<void>): void;
}

const completionSchema = z.object({
  key: z.string(), outcome: z.enum(['saved', 'skipped', 'failed']),
  paths: z.array(z.string()).default([]), commit: z.string().default(''), message: z.string(),
});

export function installIngestion(bb: BbPluginApi, host: HostPorts, openLedger = () => {
  const db = bb.storage.database();
  return new IngestionLedger({
    exec: sql => db.exec(sql),
    prepare: sql => ({ all: () => db.prepare(sql).all(), get: key => db.prepare(sql).get(key), run: value => db.prepare(sql).run(value) }),
    transaction: work => db.transaction(work),
  });
}): void {
  const settings = bb.settings.define({
    ingestEnabled: { type: 'boolean', label: 'Ingest completed recordings into Klimble', default: false },
    ingestProject: { type: 'project', label: 'Klimble project', default: '' },
  });
  let ledger: IngestionLedger | undefined;
  const store = () => ledger ??= openLedger();
  let active: AbortSignal | undefined;
  let queue = Promise.resolve();

  async function destination() {
    const config = await settings.get();
    if (!config.ingestEnabled || !config.ingestProject) return null;
    const hostId = await host.hostId();
    const project = await bb.sdk.projects.get({ projectId: config.ingestProject });
    const source = project.sources.find(source => source.hostId === hostId && source.isDefault)
      ?? project.sources.find(source => source.hostId === hostId);
    if (!source) throw new Error('The Klimble project needs a checkout on the Vox recording host.');
    return { projectId: project.id, root: source.path, hostId };
  }

  const portsFor = (target: NonNullable<Awaited<ReturnType<typeof destination>>>): IngestionPorts => ({
    async findThread(key) {
      for (const archived of [false, true]) {
        for (let offset = 0; ; offset += 100) {
          const threads = await bb.sdk.threads.list({ projectId: target.projectId, originPluginId: bb.pluginId, archived, limit: 100, offset });
          for (const thread of threads) {
            const metadata = await bb.sdk.threads.getPluginMetadata({ threadId: thread.id });
            if (metadata.revisionKey === key) return thread.id;
          }
          if (threads.length < 100) break;
        }
      }
      return null;
    },
    async spawn(row) {
      const thread = await bb.sdk.threads.spawn({
        projectId: target.projectId,
        environment: { type: 'host', hostId: target.hostId, workspace: { type: 'unmanaged', path: target.root } },
        prompt: ingestionPrompt(row), title: `Vox: ${row.name}`, providerId: 'codex', permissionMode: 'auto',
        pluginMetadata: { revisionKey: row.key, recordingIdentity: row.identity, transcriptHash: row.hash },
      });
      return thread.id;
    },
    async send(threadId, row) {
      await bb.sdk.threads.unarchive({ threadId });
      await bb.sdk.threads.send({ threadId, mode: 'auto', input: [{ type: 'text', text: ingestionPrompt(row), mentions: [] }] });
      await bb.sdk.threads.updatePluginMetadata({ threadId, set: { revisionKey: row.key, transcriptHash: row.hash } });
    },
  });

  async function reconcile() {
    if (!active || active.aborted) return;
    const target = await destination();
    if (!target || active.aborted) return;
    const candidates = (await host.completed()).map(candidate => ({ ...candidate, identity: `${target.projectId}:${target.hostId}:${candidate.identity}` }));
    const ledger = store();
    ledger.baseline(`${target.projectId}:${target.hostId}`, candidates);
    for (const candidate of candidates) {
      if (active.aborted || !(await settings.get()).ingestEnabled) return;
      if (ledger.get(revisionKey(candidate))) continue;
      // A changed transcript waits until its earlier revision has finished.
      if (ledger.list().some(row => row.identity === candidate.identity && ['pending', 'dispatching', 'uncertain', 'spawned'].includes(row.state))) continue;
      const { text } = await host.transcript(candidate.name);
      ledger.freeze(candidate, text);
    }
    for (const row of ledger.list()) {
      if (active.aborted) return;
      if (!row.identity.startsWith(`${target.projectId}:${target.hostId}:`)) continue;
      if (row.state === 'pending' || row.state === 'dispatching' || row.state === 'uncertain') {
        await dispatch(ledger, portsFor(target), row);
      } else if (row.state === 'spawned' && row.threadId) {
        const thread = await bb.sdk.threads.get({ threadId: row.threadId });
        if (thread.status === 'error' || (thread.status === 'idle' && thread.queuedMessageCount === 0)) {
          ledger.save({ ...row, state: 'failed', error: 'The thread ended without confirming saved Klimble notes. Retry this revision in its existing thread.' });
        }
      }
    }
  }

  function enqueue(work: () => Promise<void>): Promise<void> {
    const next = queue.then(work);
    queue = next.catch(error => bb.log.error(`vox ingestion: ${String(error)}`));
    return next;
  }
  host.onChange(() => enqueue(reconcile));
  settings.onChange(() => { void enqueue(reconcile).catch(() => {}); });
  bb.background.service('transcript-ingestion', {
    async start(signal) {
      active = signal;
      const connected = bb.sdk.subscribe({ event: 'realtime:connection', callback: event => {
        if (event.state === 'connected') void enqueue(async () => { await host.subscribe(); await reconcile(); }).catch(() => {});
      } });
      try {
        await host.subscribe();
        await enqueue(reconcile);
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
      } finally {
        connected();
        await queue;
        if (active === signal) active = undefined;
      }
    },
  });

  bb.agents.registerTool({
    name: 'vox_ingestion_complete',
    description: 'Confirm that this Vox ingestion saved checked notes in Klimble, skipped non-business content, or failed. Call after committing saved notes.',
    parameters: completionSchema,
    execute: async (result, context) => {
      const target = await destination();
      if (!target || context.projectId !== target.projectId) throw new Error('This is not the configured Klimble project.');
      const ledger = store();
      const row = ledger.get(result.key);
      if (!row || (row.threadId && row.threadId !== context.threadId)) throw new Error('This ingestion revision does not belong to this thread.');
      if (!row.threadId) {
        const metadata = await bb.sdk.threads.getPluginMetadata({ threadId: context.threadId });
        if (metadata.revisionKey !== row.key) throw new Error('Missing ingestion correlation.');
      }
      if (result.outcome === 'saved') {
        if (!result.paths.length || !/^[a-f0-9]{7,40}$/.test(result.commit)) throw new Error('Pass the saved call-record path and commit ID.');
        let provenance = false;
        for (const relative of result.paths) {
          const path = resolve(target.root, relative);
          if (!path.startsWith(resolve(target.root) + sep) || !path.endsWith('.md')) throw new Error('Saved notes must be Markdown inside Klimble.');
          const file = await bb.sdk.files.read({ hostId: target.hostId, path });
          if (file.content.includes(row.hash)) provenance = true;
        }
        if (!provenance) throw new Error('The saved call record must contain the transcript hash.');
      }
      ledger.save({ ...row, threadId: context.threadId,
        state: result.outcome === 'saved' ? 'succeeded' : result.outcome === 'skipped' ? 'skipped' : 'failed',
        error: result.outcome === 'failed' ? result.message : null });
      return `Recorded ${result.outcome} for ${row.name}.`;
    },
  });

  bb.cli.register({
    name: 'vox', summary: 'Inspect Vox transcript ingestion into Klimble',
    commands: [
      { name: 'ingest', summary: 'Inspect, run or retry recording ingestion', usage: 'bb vox ingest status | bb vox ingest run <recording-name> | bb vox ingest retry <revision-key>' },
    ],
    async run(argv) {
      if (argv.join(' ') === 'ingest status') {
        const config = await settings.get();
        return { exitCode: 0, stdout: JSON.stringify({ enabled: config.ingestEnabled, projectId: config.ingestProject,
          recordings: store().list().map(({ text: _text, ...row }) => row) }, null, 2) };
      }
      if (argv.length === 3 && argv[0] === 'ingest' && argv[1] === 'run') {
        let key = '';
        await enqueue(async () => {
          const target = await destination();
          if (!target) throw new Error('Enable a Klimble destination first.');
          const found = (await host.completed()).find(candidate => candidate.name === argv[2]);
          if (!found) throw new Error('That recording has no completed, non-empty transcript.');
          const candidate = { ...found, identity: `${target.projectId}:${target.hostId}:${found.identity}` };
          key = revisionKey(candidate);
          const existing = store().get(key);
          if (existing && existing.state !== 'skipped') return;
          if (store().list().some(row => row.identity === candidate.identity && ['pending', 'dispatching', 'uncertain', 'spawned'].includes(row.state))) throw new Error('An earlier revision is still being ingested.');
          const { text } = await host.transcript(candidate.name);
          if (digest(text) !== candidate.hash) throw new Error('The transcript changed. Run ingestion again after publication.');
          const row = existing ? { ...existing, text, state: 'pending' as const, error: null } : store().freeze(candidate, text);
          if (!row) throw new Error('Could not freeze the transcript.');
          store().save(row);
          await dispatch(store(), portsFor(target), row);
        });
        const row = store().get(key);
        return { exitCode: row?.state === 'uncertain' ? 1 : 0, stdout: JSON.stringify(row && { key: row.key, state: row.state, threadId: row.threadId, error: row.error }) };
      }
      if (argv.length === 3 && argv[0] === 'ingest' && argv[1] === 'retry') {
        const key = argv[2];
        await enqueue(async () => {
          const row = store().get(key);
          if (!row || row.state !== 'failed' || !row.threadId) throw new Error('Only a failed ingestion with a known thread can be retried.');
          const target = await destination();
          if (!target || !row.identity.startsWith(`${target.projectId}:${target.hostId}:`)) throw new Error('Enable the matching Klimble destination first.');
          store().save({ ...row, state: 'pending', error: null });
          await dispatch(store(), portsFor(target), { ...row, state: 'pending', error: null });
        });
        const row = store().get(key);
        return { exitCode: row?.state === 'uncertain' ? 1 : 0, stdout: JSON.stringify(row && { key: row.key, state: row.state, threadId: row.threadId, error: row.error }) };
      }
      return { exitCode: 1, stderr: 'Usage: bb vox ingest status | bb vox ingest run <recording-name> | bb vox ingest retry <revision-key>' };
    },
  });
}
