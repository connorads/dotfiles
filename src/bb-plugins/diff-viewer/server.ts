import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, rpcContract, type Review } from './contracts.ts';

/** A little longer than the host's own 20-second git timeout, so the host reports it first. */
const hostTimeoutMs = 30_000;

export default function plugin(bb: BbPluginApi) {
  bb.agents.contributeInstructions(() => 'To open a continuous diff for a verified checkout, emit inline code: git-review://HOST_ID/absolute/checkout/path?scope=uncommitted. Scopes are uncommitted, unpushed or branch. URI-encode path segments. Verify the host and checkout root. State whether changes are working files, commits or an unapplied patch. An unapplied patch must first be applied to a separate review worktree to appear here.');
  const host = bb.hosts.experimental_client({ contract: hostContract });

  async function checkout(threadId: string, explicit?: Review['target']): Promise<{ hostId: string; root: string; exact?: boolean } | null> {
    const { environmentId } = await bb.sdk.threads.get({ threadId });
    if (!environmentId) return null;
    const { hostId, path } = await bb.sdk.environments.get({ environmentId });
    if (explicit) {
      if (explicit.hostId !== hostId) throw new Error('Review checkout belongs to a different host from this thread.');
      return { hostId, root: explicit.path, exact: true };
    }
    return path ? { hostId, root: path } : null;
  }

  bb.rpc.register(rpcContract, {
    load: async ({ threadId, target: explicit, scope }) => {
      const target = await checkout(threadId, explicit);
      if (!target) return { kind: 'none' as const };
      return host.call('load', { root: target.root, ...(target.exact ? { exact: true } : {}), scope }, { hostId: target.hostId, timeoutMs: hostTimeoutMs });
    },
    file: async ({ threadId, target: explicit, ...input }) => {
      const target = await checkout(threadId, explicit);
      if (!target) throw new Error('This thread has no checkout.');
      return host.call('file', { root: target.root, ...(target.exact ? { exact: true } : {}), ...input }, { hostId: target.hostId, timeoutMs: hostTimeoutMs });
    },
    fingerprint: async ({ threadId, target: explicit }) => {
      const target = await checkout(threadId, explicit);
      if (!target) return null;
      return host.call('fingerprint', { root: target.root, ...(target.exact ? { exact: true } : {}) }, { hostId: target.hostId, timeoutMs: hostTimeoutMs });
    },
  });
}
