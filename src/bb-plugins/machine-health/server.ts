import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, rpcContract } from './contracts.ts';
import { createTtlCache } from './src/cache.ts';
import { actionText, rankThreads } from './src/format.ts';
import { readable, readGauge } from './src/gauge.ts';
import { hibernateAll, refusal, summarise, workRefusal, type ThreadFacts } from './src/hibernate.ts';
import { readMachine, readMachines, type MachinePorts, type Sample } from './src/machine.ts';
import type { Work } from './src/triage.ts';

/** Chips poll every 10 s; every chip, window and split pane shares one sample per machine for this long. */
const sampleTtlMs = 5_000;
const settle = { settleMs: 6_000, pollMs: 750 };

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const samples = createTtlCache<string, Sample>(sampleTtlMs, Date.now);
  const config = createTtlCache<'config', string | null>(60_000, Date.now);

  const ports: MachinePorts = {
    primaryHostId: () => config.get('config', async () => (await bb.sdk.system.config()).primaryHostId),
    sample: hostId => samples.get(hostId, () => host.call('sample', {}, { hostId, timeoutMs: 10_000 })),
  };

  async function hostOf(threadId: string): Promise<string | null> {
    const { environmentId } = await bb.sdk.threads.get({ threadId });
    if (!environmentId) return null;
    return (await bb.sdk.environments.get({ environmentId })).hostId;
  }
  async function facts(threadId: string): Promise<ThreadFacts & { title: string }> {
    const [thread, interactions] = await Promise.all([
      bb.sdk.threads.get({ threadId }),
      bb.sdk.threads.interactions.list({ threadId }),
    ]);
    return {
      title: thread.title ?? thread.titleFallback ?? thread.id,
      status: thread.status, runtimeStatus: thread.runtime.displayStatus,
      queuedMessageCount: thread.queuedMessageCount, activeBackgroundAgentCount: thread.activeBackgroundAgentCount,
      pendingInteractions: interactions.length, archived: thread.archivedAt !== null || thread.deletedAt !== null,
    };
  }
  async function processes(hostId: string, threadIds: string[]): Promise<Map<string, Work | null>> {
    const { threads } = await host.call('processes', { threadIds }, { hostId });
    return new Map(threads.map(thread => [thread.threadId, thread.work]));
  }

  bb.rpc.register(rpcContract, {
    thread: async ({ threadId }) => {
      const hostId = await hostOf(threadId);
      if (!hostId) return { machine: null };
      return { machine: await readMachine(await bb.sdk.hosts.get({ hostId }), ports) };
    },
    machines: async () => ({ machines: await readMachines(await bb.sdk.hosts.list(), ports) }),
    triage: async ({ threadId }) => {
      const hostId = await hostOf(threadId);
      if (!hostId) throw new Error('This thread has no machine to read.');
      const sample = await host.call('triage', {}, { hostId, timeoutMs: 25_000 });
      if (!readable(sample.raw)) throw new Error('Memory triage reads macOS compressor counters; this machine has none.');
      const threads = rankThreads(await Promise.all(sample.threads.map(async usage => {
        try {
          const thread = await facts(usage.threadId);
          return { threadId: usage.threadId, title: thread.title, mb: usage.mb,
            refusal: refusal(thread) ?? (usage.work ? workRefusal(usage.work) : null) };
        } catch {
          // A provider process whose thread bb no longer knows: show it, never stop it.
          return { threadId: usage.threadId, title: usage.threadId, mb: usage.mb, refusal: 'unknown thread' };
        }
      })));
      return { hostId, gauge: readGauge(sample.raw), apps: sample.apps, threads, action: actionText(threads) };
    },
    hibernate: async ({ hostId, threadIds }) => {
      const onHost = new Set<string>();
      const outcomes = await hibernateAll(threadIds, {
        // Each thread must live on the machine the user is triaging. Checked once, before the
        // gate, so the host round trip never sits between the last check and the stop.
        facts: async threadId => {
          if (!onHost.has(threadId)) {
            if (await hostOf(threadId) !== hostId) throw new Error('Thread is on a different machine.');
            onHost.add(threadId);
          }
          return facts(threadId);
        },
        processes: ids => processes(hostId, ids),
        stop: async threadId => { await bb.sdk.threads.stop({ threadId }); },
        sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      }, settle);
      samples.delete(hostId);
      const summary = summarise(outcomes);
      bb.log.info(`hibernate on ${hostId}: ${summary}`);
      return { outcomes, summary };
    },
    terminate: async ({ hostId, pid, command }) => {
      const result = await host.call('terminate', { pid, command }, { hostId });
      samples.delete(hostId);
      if (result.ok) bb.log.info(`terminated pid ${pid} on ${hostId}`);
      return result;
    },
  });
}
