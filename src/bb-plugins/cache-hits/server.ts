import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { rpcContract } from './contracts.ts';
import { initialState, observe, type CacheState, type Observation } from './src/cache.ts';
export { rpcContract } from './contracts.ts';

type Saved = { sequence: number; state: CacheState };
const pageSize = 100;
const types = ['thread/tokenUsage/updated', 'thread/contextWindowUsage/updated', 'thread/compacted', 'thread/context/cleared'] as const;

export default function plugin(bb: BbPluginApi) {
  const key = (id: string) => `thread:${id}`;
  // bb keeps only the latest usage events, so the plugin folds each one as it lands and stores the result.
  const queues = new Map<string, Promise<void>>();
  async function sync(threadId: string, providerId: string) {
    const saved = await bb.storage.kv.get<Saved>(key(threadId));
    let { sequence, state } = saved ?? { sequence: 0, state: initialState(providerId) };
    let changed = false;
    for (;;) {
      const events = await bb.sdk.threads.events.list({ threadId, types: [...types], order: 'asc', limit: String(pageSize),
        ...(saved || changed ? { afterSeq: String(sequence) } : {}) });
      for (const event of events) {
        const observation: Observation = event.type === 'thread/tokenUsage/updated'
          ? { kind: 'usage', at: event.createdAt, usage: event.data.tokenUsage.last }
          : event.type === 'thread/contextWindowUsage/updated'
            ? { kind: 'context', used: event.data.contextWindowUsage.usedTokens }
            : { kind: 'reset' };
        state = observe(state, providerId, observation);
        sequence = Math.max(sequence, event.seq);
        changed = true;
      }
      if (events.length < pageSize) break;
    }
    if (!changed) return;
    await bb.storage.kv.set(key(threadId), { sequence, state } satisfies Saved);
    bb.realtime.publish('cache-changed', { threadId });
  }
  bb.events.on('experimental_thread.events', ({ thread }) => {
    const next = (queues.get(thread.id) ?? Promise.resolve()).then(() => sync(thread.id, thread.providerId))
      .catch(error => bb.log.warn(`Cache sync failed for ${thread.id}: ${error instanceof Error ? error.message : error}`));
    queues.set(thread.id, next);
    void next.finally(() => { if (queues.get(thread.id) === next) queues.delete(thread.id); });
  });
  bb.events.on('thread.deleted', ({ thread }) => bb.storage.kv.delete(key(thread.id)));
  bb.rpc.register(rpcContract, {
    thread: async input => (await bb.storage.kv.get<Saved>(key(input.threadId)))?.state ?? null,
  });
}
