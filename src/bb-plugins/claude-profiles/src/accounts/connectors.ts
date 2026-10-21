import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { connectorsContract, type ConnectorState } from './connectors-contract.ts';

const connectorVariable = 'ENABLE_CLAUDEAI_MCP_SERVERS';
const choiceSchema = z.object({ enabled: z.boolean(), afterSeq: z.number() });
const initialChoice = { enabled: false, afterSeq: 0 };

export function registerConnectors(bb: BbPluginApi, switching: Set<string>, prepareChange: (threadId: string) => Promise<void>) {
  const key = (threadId: string) => `connectors:${threadId}`;
  async function choice(threadId: string) {
    const value = choiceSchema.safeParse(await bb.storage.kv.get(key(threadId)));
    return value.success ? value.data : initialChoice;
  }
  async function latestLaunch(threadId: string) {
    const [event] = await bb.sdk.threads.events.list({ threadId, types: ['provider.env-resolved'], order: 'desc', limit: '1' });
    return event?.type === 'provider.env-resolved' ? event : undefined;
  }
  async function state(threadId: string | null): Promise<ConnectorState> {
    if (threadId === null) return { enabled: false, launch: 'pending' };
    const saved = await choice(threadId);
    const event = await latestLaunch(threadId);
    if (!event || event.seq <= saved.afterSeq) return { enabled: saved.enabled, launch: 'pending' };
    const value = event.data.entries.find(entry => entry.name === connectorVariable)?.value;
    return { enabled: saved.enabled, launch: value === 'true' ? 'on' : value === 'false' ? 'off' : 'unknown' };
  }
  async function set(threadId: string, enabled: boolean) {
    if (switching.has(threadId)) throw new Error('Claude session settings are changing. Try again after they finish.');
    switching.add(threadId);
    try {
      await prepareChange(threadId);
      const latest = await latestLaunch(threadId);
      await bb.storage.kv.set(key(threadId), { enabled, afterSeq: latest?.seq ?? 0 });
    } finally { switching.delete(threadId); }
    bb.realtime.publish('profiles-changed', { threadId });
    return state(threadId);
  }
  bb.rpc.register(connectorsContract, { 'connectors.get': ({ threadId }) => state(threadId),
    'connectors.set': ({ threadId, enabled }) => set(threadId, enabled) });
  async function claim(thread: { id: string; originKind: 'fork' | null; sourceThreadId: string | null }) {
    if (await bb.storage.kv.get(key(thread.id))) return;
    const source = thread.originKind === 'fork' ? thread.sourceThreadId : null;
    const saved = source ? await choice(source) : initialChoice;
    await bb.storage.kv.set(key(thread.id), { enabled: saved.enabled, afterSeq: 0 });
  }
  return {
    state, set,
    async invalidate(threadId: string) {
      const saved = await choice(threadId);
      const latest = await latestLaunch(threadId);
      await bb.storage.kv.set(key(threadId), { enabled: saved.enabled, afterSeq: latest?.seq ?? 0 });
    },
    async env(threadId: string) {
      if (!await bb.storage.kv.get(key(threadId))) {
        const thread = await bb.sdk.threads.get({ threadId });
        await claim({ ...thread, id: threadId });
      }
      return [{ name: connectorVariable, value: String((await choice(threadId)).enabled), reason: 'Claude account connectors' }];
    },
    claim,
  };
}
