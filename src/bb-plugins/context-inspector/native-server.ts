import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { claudeLaunchOverrides, nativeHostContract, type NativeResult } from './native-contract';

type Sdk = BbPluginApi['sdk'];
const recordingKey = (threadId: string) => `recording:${threadId}`;
const missing = (reason: string): NativeResult => ({ kind: 'unavailable', reason });

/** Identity and lifecycle events only. Conversation bodies never enter this join. */
export async function nativeTarget(sdk: Sdk, threadId: string) {
  const thread = await sdk.threads.get({ threadId });
  if (!thread.environmentId) throw new Error('This thread has no execution workspace.');
  const [environment, identities, changes] = await Promise.all([
    sdk.environments.get({ environmentId: thread.environmentId }),
    sdk.threads.events.list({ threadId, types: ['thread/identity', 'thread/context/cleared'], order: 'desc', limit: '1' }),
    sdk.threads.events.list({ threadId, types: ['thread/identity', 'thread/context/cleared', 'thread/compacted', 'turn/started', 'turn/completed'], order: 'desc', limit: '1' }),
  ]);
  const identity = identities[0];
  const sessionId = identity?.type === 'thread/identity' ? identity.data.providerThreadId : null;
  return { thread, environment, sessionId, revision: changes[0]?.seq ?? 0 };
}

export function nativeServices(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: nativeHostContract });
  const busy = new Set<string>();
  const enabled = async (threadId: string) => await bb.storage.kv.get<boolean>(recordingKey(threadId)) === true;
  bb.providers.experimental_contributeEnv('codex', async input => {
    if (!await enabled(input.threadId)) return [];
    const root = await host.call('traceRoot', { threadId: input.threadId }, { hostId: input.hostId, timeoutMs: 3500 });
    return [{ name: 'CODEX_ROLLOUT_TRACE_ROOT', value: root.path, reason: 'Opt-in native context diagnostics for this thread.' }];
  });
  return {
    async native({ threadId, collect }: { threadId: string; collect: boolean }) {
      const tracingEnabled = await enabled(threadId);
      const before = await nativeTarget(bb.sdk, threadId);
      const providerId = before.thread.providerId;
      const result = (report: NativeResult) => ({ providerId, tracingEnabled, report });
      if (!before.sessionId) return result(missing('Native session identity is unavailable. Send a message after a context reset.'));
      if (providerId !== 'codex' && providerId !== 'claude-code') return result(missing('Native diagnostics support Claude Code and Codex.'));
      if (providerId === 'claude-code' && !collect) return result(missing('Read a native summary to inspect the saved Claude session.'));
      if (busy.has(threadId)) return result(missing('A native diagnostic is already running for this thread.'));
      busy.add(threadId);
      try {
        let report: NativeResult;
        if (providerId === 'codex') {
          report = await host.call('codex', { threadId, sessionId: before.sessionId }, { hostId: before.environment.hostId, timeoutMs: 15000 });
        } else {
          if (!['idle', 'error'].includes(before.thread.status) || before.thread.activeBackgroundAgentCount || before.thread.queuedMessageCount) return result(missing('Finish the turn and queued work before reading a saved-session summary.'));
          if (!before.environment.path) return result(missing('The Claude workspace path is unavailable.'));
          const events = await bb.sdk.threads.events.list({ threadId, types: ['provider.env-resolved'], order: 'desc', limit: '1' });
          const event = events[0];
          if (!event || event.type !== 'provider.env-resolved' || event.data.providerThreadId !== before.sessionId) return result(missing('The native launch environment is unavailable for this session.'));
          const entries = event.data.entries;
          const directory = entries.find(entry => entry.name === 'CLAUDE_CONFIG_DIR');
          if (directory && typeof directory.value !== 'string') return result(missing('The Claude account directory is unavailable.'));
          if (entries.some(entry => claudeLaunchOverrides.some(name => name === entry.name))) return result(missing('This session uses a custom authentication or endpoint environment. Use its recorded BB report.'));
          report = await host.call('claude', { sessionId: before.sessionId, cwd: before.environment.path,
            ...(directory && typeof directory.value === 'string' ? { configDir: directory.value } : {}),
          }, { hostId: before.environment.hostId, timeoutMs: 25000 });
        }
        const after = await nativeTarget(bb.sdk, threadId);
        if (after.sessionId !== before.sessionId || after.environment.hostId !== before.environment.hostId || after.environment.id !== before.environment.id || after.thread.providerId !== providerId || after.revision !== before.revision) return result(missing('The session changed during collection. Read the report again.'));
        if (providerId === 'claude-code' && (!['idle', 'error'].includes(after.thread.status) || after.thread.activeBackgroundAgentCount || after.thread.queuedMessageCount)) return result(missing('The session changed during collection. Read the report again.'));
        return result(report);
      } catch { return result(missing('Native collection failed on the execution host.')); }
      finally { busy.delete(threadId); }
    },
    async tracing({ threadId, enabled: desired }: { threadId: string; enabled: boolean }) {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.providerId !== 'codex') throw new Error('Trace recording is available for Codex threads.');
      if (busy.has(threadId)) throw new Error('Wait for native collection to finish.');
      await bb.storage.kv.set(recordingKey(threadId), desired);
      return { enabled: desired };
    },
    async purge({ threadId }: { threadId: string }) {
      const target = await nativeTarget(bb.sdk, threadId);
      if (target.thread.providerId !== 'codex') throw new Error('Trace deletion is available for Codex threads.');
      if (!['idle', 'error'].includes(target.thread.status) || target.thread.activeBackgroundAgentCount || target.thread.queuedMessageCount || busy.has(threadId)) throw new Error('Finish the turn and queued work before deleting traces.');
      busy.add(threadId);
      try {
        await bb.storage.kv.set(recordingKey(threadId), false);
        const stillIdle = async () => {
          const current = await nativeTarget(bb.sdk, threadId);
          if (current.sessionId !== target.sessionId || current.environment.hostId !== target.environment.hostId || current.environment.id !== target.environment.id || current.thread.providerId !== 'codex' || current.revision !== target.revision || !['idle', 'error'].includes(current.thread.status) || current.thread.activeBackgroundAgentCount || current.thread.queuedMessageCount) throw new Error('The session changed. Trace deletion was cancelled.');
        };
        await stillIdle();
        return await host.call('purge', { threadId }, { hostId: target.environment.hostId, timeoutMs: 15000 });
      } finally { busy.delete(threadId); }
    },
  };
}
