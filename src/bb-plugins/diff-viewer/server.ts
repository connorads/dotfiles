import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, rpcContract } from './contracts.ts';

/** A little longer than the host's own 20-second git timeout, so the host reports it first. */
const hostTimeoutMs = 30_000;

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });

  async function checkout(threadId: string): Promise<{ hostId: string; root: string } | null> {
    const { environmentId } = await bb.sdk.threads.get({ threadId });
    if (!environmentId) return null;
    const { hostId, path } = await bb.sdk.environments.get({ environmentId });
    return path ? { hostId, root: path } : null;
  }

  bb.rpc.register(rpcContract, {
    load: async ({ threadId, scope }) => {
      const target = await checkout(threadId);
      if (!target) return { kind: 'none' as const };
      return host.call('load', { root: target.root, scope }, { hostId: target.hostId, timeoutMs: hostTimeoutMs });
    },
    file: async ({ threadId, ...input }) => {
      const target = await checkout(threadId);
      if (!target) throw new Error('This thread has no checkout.');
      return host.call('file', { root: target.root, ...input }, { hostId: target.hostId, timeoutMs: hostTimeoutMs });
    },
  });
}
