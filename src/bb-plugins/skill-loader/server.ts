import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, rpcContract } from './contracts.ts';
import { createCache } from './src/cache.ts';
import { MENTION_PROVIDER_ID, decodeMentionId, mentionItems } from './src/mention.ts';
import { filterRows, type Row } from './src/rows.ts';
import { resolveTarget, type TargetPorts } from './src/target.ts';

const catalogueTtlMs = 60_000;
const mentionLimit = 30;
// bb time-boxes mention resolve at 10s and blocks the send if it throws.
const resolveTimeoutMs = 9_000;

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const catalogues = createCache<Row[]>(catalogueTtlMs);

  const ports: TargetPorts = {
    threadEnvironmentId: async threadId => (await bb.sdk.threads.get({ threadId })).environmentId ?? null,
    environment: async environmentId => {
      const { hostId, path } = await bb.sdk.environments.get({ environmentId });
      return { hostId, path: path ?? null };
    },
    primaryHostId: async () => (await bb.sdk.system.config()).primaryHostId,
  };

  const catalogue = (hostId: string, fresh: boolean) =>
    catalogues.get(hostId, async () => (await host.call('list', {}, { hostId, timeoutMs: 20_000 })).rows, { fresh });

  // A cold host worker plus `skl list` can outlast the 2s mention search
  // budget, and bb never sends a bare `@` to providers. Warm the primary host once per load;
  // host calls are refused while the factory runs, so this is a service.
  bb.background.service('warm-catalogue', {
    async start(signal) {
      try {
        const hostId = await ports.primaryHostId();
        if (hostId) await catalogue(hostId, false);
      } catch (cause) {
        if (!signal.aborted) bb.log.warn(`skl catalogue warm-up failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    },
  });

  bb.rpc.register(rpcContract, {
    catalogue: async ({ threadId }) => {
      const target = await resolveTarget(threadId, ports);
      return { hostId: target.hostId, canInstall: target.cwd !== null, rows: await catalogue(target.hostId, true) };
    },
    preview: ({ hostId, ref }) => host.call('preview', { ref }, { hostId }),
    pointers: ({ hostId, refs }) => host.call('pointers', { refs }, { hostId }),
    install: async ({ threadId, refs }) => {
      const target = await resolveTarget(threadId, ports);
      if (!target.cwd) return { ok: false, output: 'This thread has no checkout to install into.' };
      return host.call('install', { refs, cwd: target.cwd }, { hostId: target.hostId, timeoutMs: 130_000 });
    },
  });

  bb.ui.registerMentionProvider({
    id: MENTION_PROVIDER_ID,
    label: 'Skills (skl)',
    search: async ({ query, threadId }) => {
      const target = await resolveTarget(threadId, ports);
      // `@` is shared with file mentions, so an empty query lists nothing; Alt+S is the browse path.
      if (query.trim() === '') return [];
      return mentionItems(target.hostId, filterRows(await catalogue(target.hostId, false), query), mentionLimit);
    },
    resolve: async itemId => {
      const target = decodeMentionId(itemId);
      if (!target) throw new Error(`Unreadable skill pill ${JSON.stringify(itemId)}.`);
      const { text } = await host.call('pointers', { refs: [target.ref] }, { hostId: target.hostId, timeoutMs: resolveTimeoutMs });
      return { context: text };
    },
  });
}
