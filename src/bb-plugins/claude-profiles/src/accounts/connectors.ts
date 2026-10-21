import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import type { Selection } from '../../contracts.ts';
import { connectorsContract, type ConnectorState } from './connectors-contract.ts';

const connectorVariable = 'ENABLE_CLAUDEAI_MCP_SERVERS';
const choiceSchema = z.object({ mode: z.enum(['account', 'off']), afterSeq: z.number(), restartRequired: z.boolean() });
type Choice = z.infer<typeof choiceSchema>;
const initialChoice: Choice = { mode: 'account', afterSeq: 0, restartRequired: false };
const legacyChoice = z.object({ enabled: z.boolean(), afterSeq: z.number() });
const globalKey = 'connector-policy:blocked';
const accountKey = (hostId: string, profileId: string) => `connector-policy:account:${encodeURIComponent(hostId)}:${encodeURIComponent(profileId)}`;
const key = (threadId: string) => `connectors:${threadId}`;
type Thread = Awaited<ReturnType<BbPluginApi['sdk']['threads']['get']>>;
const idle = (thread: Thread) => ['idle', 'error'].includes(thread.status) && !thread.activeBackgroundAgentCount;

export function registerConnectors(bb: BbPluginApi, switching: Set<string>,
  scope: (threadId: string | null, profileId?: string) => Promise<{ hostId: string; profileId: string }>) {
  let changing = false;
  let restarting = false;
  async function choice(threadId: string): Promise<Choice> {
    const raw = await bb.storage.kv.get(key(threadId));
    const value = choiceSchema.safeParse(raw);
    if (value.success) return value.data;
    const legacy = legacyChoice.safeParse(raw);
    if (!legacy.success) return initialChoice;
    const migrated: Choice = { mode: legacy.data.enabled ? 'account' : 'off', afterSeq: legacy.data.afterSeq, restartRequired: false };
    await bb.storage.kv.set(key(threadId), migrated);
    return migrated;
  }
  async function latestLaunch(threadId: string) {
    const [event] = await bb.sdk.threads.events.list({ threadId, types: ['provider.env-resolved'], order: 'desc', limit: '1' });
    return event?.type === 'provider.env-resolved' ? event : undefined;
  }
  async function enabled(threadId: string, hostId: string) {
    const selected = await bb.storage.kv.get<Selection>(`thread:${threadId}`);
    if (selected && selected.hostId !== hostId) return false;
    return !await bb.storage.kv.get(globalKey) && (await choice(threadId)).mode === 'account'
      && await bb.storage.kv.get(accountKey(hostId, selected?.profile.id ?? 'default')) === true;
  }
  async function pendingIds() {
    const pending: string[] = [];
    for (const entry of await bb.storage.kv.list('connectors:')) {
      const id = entry.slice('connectors:'.length);
      if ((await choice(id)).restartRequired) pending.push(id);
    }
    if (!pending.length) return pending;
    const live = new Set((await threads()).map(thread => thread.id));
    for (const id of pending) {
      if (!live.has(id)) await bb.storage.kv.set(key(id), { ...await choice(id), afterSeq: 0, restartRequired: false });
    }
    return pending.filter(id => live.has(id));
  }
  const publish = () => bb.realtime.publish('profiles-changed', {});
  async function state(threadId: string | null): Promise<ConnectorState> {
    const account = await scope(threadId);
    const accounts: Record<string, boolean> = {};
    const prefix = `connector-policy:account:${encodeURIComponent(account.hostId)}:`;
    for (const entry of await bb.storage.kv.list(prefix)) {
      accounts[decodeURIComponent(entry.slice(prefix.length))] = await bb.storage.kv.get(entry) === true;
    }
    const saved = threadId === null ? initialChoice : await choice(threadId);
    const globalBlocked = await bb.storage.kv.get(globalKey) === true;
    const event = threadId === null ? undefined : await latestLaunch(threadId);
    const value = event?.data.entries.find(entry => entry.name === connectorVariable)?.value;
    return { enabled: !globalBlocked && accounts[account.profileId] === true && saved.mode === 'account',
      mode: saved.mode, globalBlocked, accounts, profileId: account.profileId, pending: (await pendingIds()).length,
      launch: !event || (!saved.restartRequired && event.seq <= saved.afterSeq) ? 'pending' : value === 'true' ? 'on' : value === 'false' ? 'off' : 'unknown' };
  }
  async function invalidate(threadId: string, restartRequired = false) {
    const saved = await choice(threadId);
    const latest = await latestLaunch(threadId);
    await bb.storage.kv.set(key(threadId), { ...saved, afterSeq: latest?.seq ?? 0, restartRequired });
  }
  async function stop(threadId: string, force: boolean, mode?: Choice['mode']) {
    if (changing || (restarting && !force) || switching.has(threadId)) throw new Error('Claude session settings are changing. Try again after they finish.');
    switching.add(threadId);
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      if (!force && (!idle(thread) || (mode !== undefined && thread.queuedMessageCount > 0))) throw new Error('Finish the turn and clear queued messages before applying connector changes.');
      await bb.sdk.threads.stop({ threadId });
      if (!idle(await bb.sdk.threads.get({ threadId }))) throw new Error('Claude is still stopping. Connector restart remains pending.');
      await invalidate(threadId);
      if (mode !== undefined) await bb.storage.kv.set(key(threadId), { ...await choice(threadId), mode });
    } finally { switching.delete(threadId); }
  }
  async function settle(threadId: string) {
    if (changing || restarting || switching.has(threadId) || !(await choice(threadId)).restartRequired) return;
    const thread = await bb.sdk.threads.get({ threadId });
    if (idle(thread)) {
      try { await stop(threadId, false); publish(); }
      catch (error) { bb.log.warn(`Connector restart remains pending: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  async function threads() {
    const result: Array<{ id: string; environmentId: string }> = [];
    for (let offset = 0; ; offset += 100) {
      const page = await bb.sdk.threads.list({ archived: false, includeHidden: true, offset, limit: 100 });
      for (const thread of page) {
        if (thread.providerId === 'claude-code' && thread.environmentId) result.push({ id: thread.id, environmentId: thread.environmentId });
      }
      if (page.length < 100) return result;
    }
  }
  async function change(write: () => Promise<void>, account?: {hostId: string; profileId: string}) {
    if (changing || restarting || switching.size) throw new Error('Claude session settings are changing. Try again after they finish.');
    changing = true;
    const affected: string[] = [];
    try {
      const candidates = [];
      for (const thread of await threads()) {
        const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
        const selected = await bb.storage.kv.get<Selection>(`thread:${thread.id}`);
        if (account && (environment.hostId !== account.hostId || (selected?.profile.id ?? 'default') !== account.profileId)) continue;
        candidates.push({ thread, hostId: environment.hostId, before: await enabled(thread.id, environment.hostId), launch: await latestLaunch(thread.id) });
      }
      await write();
      for (const { thread, hostId, before, launch } of candidates) {
        const after = await enabled(thread.id, hostId);
        const value = launch?.data.entries.find(entry => entry.name === connectorVariable)?.value;
        if (before === after && value === String(after)) continue;
        await bb.storage.kv.set(key(thread.id), { ...await choice(thread.id), afterSeq: launch?.seq ?? 0, restartRequired: true });
        affected.push(thread.id);
      }
    } finally { changing = false; publish(); }
    for (const id of affected) await settle(id);
    return { pending: (await pendingIds()).length };
  }
  async function set(threadId: string, mode: Choice['mode']) {
    if (changing || restarting) throw new Error('Claude session settings are changing. Try again after they finish.');
    await scope(threadId);
    await stop(threadId, false, mode);
    publish();
    return state(threadId);
  }
  bb.rpc.register(connectorsContract, {
    'connectors.get': ({ threadId }) => state(threadId),
    'connectors.set': ({ threadId, mode }) => set(threadId, mode),
    'connectors.global.set': ({ blocked }) => change(() => bb.storage.kv.set(globalKey, blocked)),
    'connectors.account.set': async ({ threadId, profileId, enabled }) => {
      const account = await scope(threadId, profileId);
      return change(() => bb.storage.kv.set(accountKey(account.hostId, account.profileId), enabled), account);
    },
    'connectors.restart': async () => {
      if (changing || restarting || switching.size) throw new Error('Claude session settings are changing. Try again after they finish.');
      restarting = true;
      try {
        for (const id of await pendingIds()) {
          try { await stop(id, true); }
          catch (error) { bb.log.warn(`Connector restart remains pending: ${error instanceof Error ? error.message : String(error)}`); }
        }
      } finally { restarting = false; publish(); }
      return { pending: (await pendingIds()).length };
    },
  });
  async function claim(thread: { id: string; originKind: 'fork' | null; sourceThreadId: string | null }, parentThreadId: string | null) {
    if (await bb.storage.kv.get(key(thread.id))) return;
    const source = thread.originKind === 'fork' ? thread.sourceThreadId : null;
    const mode: Choice['mode'] = parentThreadId ? 'off' : 'account';
    const saved = source ? await choice(source) : { ...initialChoice, mode };
    await bb.storage.kv.set(key(thread.id), { ...saved, afterSeq: 0, restartRequired: false });
  }
  return {
    state, set, invalidate, claim, settle,
    get changing() { return changing || restarting; },
    async beforeDispatch(threadId: string) {
      if (changing || restarting) throw new Error('Claude connector settings are changing. Send your message after they finish.');
      const saved = await choice(threadId);
      if (!saved.restartRequired) {
        const launch = await latestLaunch(threadId);
        if (launch && launch.seq > saved.afterSeq) {
          const account = await scope(threadId);
          const value = launch.data.entries.find(entry => entry.name === connectorVariable)?.value;
          if (value !== String(await enabled(threadId, account.hostId))) await invalidate(threadId, true);
        }
      }
      if ((await choice(threadId)).restartRequired) await stop(threadId, false);
    },
    async env(threadId: string, hostId: string) {
      if (!await bb.storage.kv.get(key(threadId))) {
        const thread = await bb.sdk.threads.get({ threadId });
        await claim({ ...thread, id: threadId }, thread.parentThreadId);
      }
      return [{ name: connectorVariable, value: String(await enabled(threadId, hostId)), reason: 'Claude account connector policy' }];
    },
  };
}
