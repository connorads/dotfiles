import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { hostContract, rpcContract } from './contracts.ts';
import { bbSample, cacheStateSchema, initialState, observe } from './src/cache.ts';
export { rpcContract } from './contracts.ts';

const savedSchema = z.object({
  sequence: z.number(),
  // Claude Code only: the transcript session, bytes read so far and the last request folded.
  sessionId: z.string().nullable(), offset: z.number(), lastId: z.string().nullable(),
  state: cacheStateSchema,
});
type Saved = z.infer<typeof savedSchema>;
const pageSize = 100;
const types = ['thread/tokenUsage/updated', 'thread/compacted', 'thread/context/cleared'] as const;

export default function plugin(bb: BbPluginApi) {
  const key = (id: string) => `thread:${id}`;
  const host = bb.hosts.experimental_client({ contract: hostContract });

  // Codex and Pi: fold BB's usage events, which arrive per request. BB keeps only recent ones.
  async function fromEvents(threadId: string, providerId: string, saved: Saved): Promise<Saved> {
    let { sequence, state } = saved;
    for (;;) {
      const events = await bb.sdk.threads.events.list({ threadId, types: [...types], order: 'asc', limit: String(pageSize),
        ...(sequence ? { afterSeq: String(sequence) } : {}) });
      for (const event of events) {
        state = observe(state, event.type === 'thread/tokenUsage/updated'
          ? { kind: 'usage', sample: bbSample(providerId, event.data.tokenUsage.last, event.createdAt) }
          : { kind: 'reset' });
        sequence = Math.max(sequence, event.seq);
      }
      if (events.length < pageSize) return { ...saved, sequence, state };
    }
  }

  // Claude Code: BB sums usage per turn, so read per-request usage and cache lifetimes from its transcript.
  async function fromTranscript(threadId: string, environmentId: string | null, saved: Saved): Promise<Saved> {
    const [[identity], [resolved]] = await Promise.all([
      bb.sdk.threads.events.list({ threadId, types: ['thread/identity'], order: 'desc', limit: '1' }),
      bb.sdk.threads.events.list({ threadId, types: ['provider.env-resolved'], order: 'desc', limit: '1' }),
    ]);
    if (identity?.type !== 'thread/identity' || !environmentId) return saved;
    const entry = resolved?.type === 'provider.env-resolved'
      ? resolved.data.entries.find(value => value.name === 'CLAUDE_CONFIG_DIR') : undefined;
    if (entry && typeof entry.value !== 'string') throw new Error('CLAUDE_CONFIG_DIR is masked, so the transcript cannot be found.');
    const configDir = typeof entry?.value === 'string' && entry.value ? entry.value : null;
    const sessionId = identity.data.providerThreadId;
    let { offset, lastId, state } = saved;
    if (sessionId !== saved.sessionId) { offset = 0; lastId = null; state = observe(state, { kind: 'reset' }); }
    const { hostId } = await bb.sdk.environments.get({ environmentId });
    const result = await host.call('transcript', { configDir, sessionId, offset }, { hostId, timeoutMs: 30000 });
    for (const item of result.items) {
      if (item.kind === 'usage' && item.id === lastId) continue;
      state = observe(state, item);
      if (item.kind === 'usage') lastId = item.id;
    }
    return { ...saved, sessionId, offset: result.offset, lastId, state };
  }

  async function sync(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    const stored = savedSchema.safeParse(await bb.storage.kv.get(key(threadId)));
    const saved: Saved = stored.success ? stored.data
      : { sequence: 0, sessionId: null, offset: 0, lastId: null, state: initialState() };
    const next = thread.providerId === 'claude-code'
      ? await fromTranscript(threadId, thread.environmentId, saved)
      : await fromEvents(threadId, thread.providerId, saved);
    if (stored.success && JSON.stringify(next) === JSON.stringify(saved)) return;
    await bb.storage.kv.set(key(threadId), next);
    bb.realtime.publish('cache-changed', { threadId });
  }
  async function invalidate(threadId: string) {
    const stored = savedSchema.safeParse(await bb.storage.kv.get(key(threadId)));
    if (!stored.success) return false;
    await bb.storage.kv.set(key(threadId), { ...stored.data, state: observe(stored.data.state, { kind: 'invalidate', at: Date.now() }) });
    bb.realtime.publish('cache-changed', { threadId });
    return true;
  }
  // One queue per thread, so a sync and an invalidation never overwrite each other's state.
  const queues = new Map<string, Promise<unknown>>();
  function enqueue<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const next = (queues.get(threadId) ?? Promise.resolve()).catch(() => {}).then(task);
    queues.set(threadId, next);
    void next.finally(() => { if (queues.get(threadId) === next) queues.delete(threadId); }).catch(() => {});
    return next;
  }
  function schedule(threadId: string) {
    enqueue(threadId, () => sync(threadId))
      .catch(error => bb.log.warn(`Cache sync failed for ${threadId}: ${error instanceof Error ? error.message : error}`));
  }
  bb.events.on('experimental_thread.events', ({ thread }) => schedule(thread.id));
  // Claude Code can flush the last request to its transcript after BB's final event notification.
  bb.events.on('thread.idle', ({ thread }) => schedule(thread.id));
  bb.events.on('thread.deleted', ({ thread }) => bb.storage.kv.delete(key(thread.id)));
  bb.rpc.register(rpcContract, {
    thread: async input => savedSchema.safeParse(await bb.storage.kv.get(key(input.threadId))).data?.state ?? null,
    invalidate: async input => ({ invalidated: await enqueue(input.threadId, () => invalidate(input.threadId)) }),
  });
}
