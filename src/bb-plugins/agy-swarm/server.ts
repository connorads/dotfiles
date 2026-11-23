import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, rpcContract } from './contracts.ts';
import { isAntigravityProvider } from './src/swarm.ts';

const hostTimeoutMs = 15_000;

interface ResolvedTarget {
  kind: 'ready';
  hostId: string;
  providerId: string;
  sessionId: string;
}

type TargetLookup =
  | ResolvedTarget
  | { kind: 'unsupported'; providerId: string | null }
  | { kind: 'no-session'; providerId: string };

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });

  async function resolveTarget(threadId: string): Promise<TargetLookup> {
    const thread = await bb.sdk.threads.get({ threadId });
    const providerId = thread.providerId ?? null;
    if (!isAntigravityProvider(providerId) || !providerId) {
      return { kind: 'unsupported', providerId };
    }
    if (!thread.environmentId) {
      return { kind: 'no-session', providerId };
    }
    const [environment, identities] = await Promise.all([
      bb.sdk.environments.get({ environmentId: thread.environmentId }),
      bb.sdk.threads.events.list({ threadId, types: ['thread/identity', 'thread/context/cleared'], order: 'desc', limit: '1' }),
    ]);
    const latest = identities[0];
    const sessionId = latest?.type === 'thread/identity' ? latest.data.providerThreadId : null;
    if (!sessionId) {
      return { kind: 'no-session', providerId };
    }
    return { kind: 'ready', hostId: environment.hostId, providerId, sessionId };
  }

  bb.rpc.register(rpcContract, {
    snapshot: async ({ threadId }) => {
      const target = await resolveTarget(threadId);
      if (target.kind !== 'ready') return target;
      return host.call('snapshot', { providerId: target.providerId, sessionId: target.sessionId }, { hostId: target.hostId, timeoutMs: hostTimeoutMs });
    },
    workerLog: async ({ threadId, member }) => {
      const target = await resolveTarget(threadId);
      if (target.kind !== 'ready') return { ok: false as const, reason: 'No active Antigravity session on this thread.' };
      return host.call('workerLog', { providerId: target.providerId, sessionId: target.sessionId, member }, { hostId: target.hostId, timeoutMs: hostTimeoutMs });
    },
    fingerprint: async ({ threadId }) => {
      const target = await resolveTarget(threadId);
      if (target.kind !== 'ready') return null;
      return host.call('fingerprint', { providerId: target.providerId, sessionId: target.sessionId }, { hostId: target.hostId, timeoutMs: hostTimeoutMs });
    },
  });
}
