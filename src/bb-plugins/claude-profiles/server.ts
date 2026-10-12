import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { accountsContract, hostContract, usageSourceContract, type Profile, type Selection } from './contracts.ts';
import { providerEnv } from './src/claude.ts';
import { initialGuard, profileApplied, reviewLaunch, type Guard } from './src/guard.ts';
import type { Usage } from './src/usage.ts';
import { decodeResourceId, measurement } from './src/usage-source.ts';
import { registerModels } from './src/models/server.ts';
export { rpcContract } from './contracts.ts';

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    profileRoot: { type: 'string', label: 'Claude profile root on each host', default: '~/.claude-profiles/code' },
    executable: { type: 'string', label: 'Native Claude executable', default: 'claude' },
  });
  const models = registerModels(bb);
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const switching = new Set<string>();
  const cache = new Map<string, Usage>();
  const probes = new Map<string, Promise<Usage>>();
  const key = (id: string) => `thread:${id}`;
  const nextKey = 'next-thread-profile';
  const guardKey = (id: string) => `guard:${id}`;
  async function context(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.providerId !== 'claude-code') throw new Error('This thread does not use Claude Code.');
    if (!thread.environmentId) throw new Error('Send the first message before choosing a profile.');
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    return { thread, environment, config: await settings.get() };
  }
  function requireIdle(thread: Awaited<ReturnType<typeof bb.sdk.threads.get>>) {
    if (!['idle', 'error'].includes(thread.status) || thread.activeBackgroundAgentCount || thread.queuedMessageCount) {
      throw new Error('Finish or stop the turn and clear queued messages before switching profiles.');
    }
  }
  async function localHostId() {
    return (await bb.sdk.hosts.list()).find(machine => machine.status === 'connected')?.id ?? null;
  }
  // The first send reaches this hook before the provider env is resolved, so the claimed selection applies to the first launch.
  async function claimNext(threadId: string, hostId: string | null) {
    const next = await bb.storage.kv.get<string>(nextKey);
    if (!next || next === 'default' || await bb.storage.kv.get<Selection>(key(threadId))) return;
    if (!hostId) throw new Error('Choose a machine before starting a thread on another Claude account.');
    const config = await settings.get();
    const profile = (await host.call('profiles', { root: config.profileRoot }, { hostId })).find(value => value.id === next);
    if (!profile) throw new Error(`Claude account ${next} does not exist on this machine. Choose another account.`);
    await bb.storage.kv.set(key(threadId), { hostId, profile } satisfies Selection);
  }
  async function latestLaunch(threadId: string) {
    const [event] = await bb.sdk.threads.events.list({ threadId, types: ['provider.env-resolved'], order: 'desc', limit: '1' });
    return event?.type === 'provider.env-resolved' ? event : undefined;
  }
  // One queue per thread, so the event review and a send never both stop the same launch.
  const reviews = new Map<string, Promise<void>>();
  function review(threadId: string) {
    const next = (reviews.get(threadId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const selected = await bb.storage.kv.get<Selection>(key(threadId));
      if (!selected?.profile.configDir) return;
      const launch = await latestLaunch(threadId);
      if (!launch) return;
      const guard = await bb.storage.kv.get<Guard>(guardKey(threadId)) ?? initialGuard;
      const result = reviewLaunch(guard, { seq: launch.seq, applied: profileApplied(launch.data.entries, selected.profile.configDir) },
        selected.profile.label);
      if (result.guard === guard) return;
      await bb.storage.kv.set(guardKey(threadId), result.guard);
      if (!result.stop) return;
      bb.log.warn(`Claude started thread ${threadId} without profile ${selected.profile.id}; stopping it.`);
      await bb.sdk.threads.stop({ threadId });
    });
    reviews.set(threadId, next);
    void next.finally(() => { if (reviews.get(threadId) === next) reviews.delete(threadId); }).catch(() => {});
    return next;
  }
  async function takeNotice(threadId: string) {
    const guard = await bb.storage.kv.get<Guard>(guardKey(threadId));
    if (!guard?.notice) return null;
    await bb.storage.kv.set(guardKey(threadId), { ...guard, notice: null });
    return guard.notice;
  }
  bb.experimental_hooks.on('message.dispatch', async input => {
    if (switching.has(input.thread.id)) return { action: 'reject', message: 'Profile switch in progress. Send your message after it finishes.' };
    if (input.thread.providerId === 'claude-code' && input.thread.status === 'pending') {
      try { await claimNext(input.thread.id, input.host?.id ?? null); }
      catch (error) { return { action: 'reject', message: error instanceof Error ? error.message : 'Could not apply the Claude account.' }; }
    } else if (input.thread.providerId === 'claude-code') {
      // The env contributor gives nothing on another machine, so Claude would start on that machine's native login.
      const selected = await bb.storage.kv.get<Selection>(key(input.thread.id));
      if (selected?.profile.configDir && input.host && input.host.id !== selected.hostId) {
        return { action: 'reject', message: `The ${selected.profile.label} account belongs to another machine. Choose this thread's account again.` };
      }
      await review(input.thread.id);
      const notice = await takeNotice(input.thread.id);
      if (notice) return { action: 'reject', message: notice };
    }
    return { action: 'proceed' };
  });
  bb.events.on('experimental_thread.events', async ({ thread }) => {
    if (thread.providerId !== 'claude-code') return;
    await review(thread.id).catch(error => bb.log.warn(`Claude profile review failed for ${thread.id}: ${error instanceof Error ? error.message : String(error)}`));
  });
  bb.providers.experimental_contributeEnv('claude-code', async input => {
    const selected = await bb.storage.kv.get<Selection>(key(input.threadId));
    if (!selected || selected.hostId !== input.hostId) return [];
    return providerEnv(selected.profile.configDir);
  });
  async function hostUsage(hostId: string, config: Awaited<ReturnType<typeof settings.get>>, profileId: string, refresh: boolean): Promise<Usage> {
    const cacheKey = JSON.stringify([hostId, config.profileRoot, config.executable, profileId]);
    const cached = cache.get(cacheKey);
    if (!refresh && cached?.status === 'ok' && cached.observedAt && Date.now() - cached.observedAt < 60000) return cached;
    const running = probes.get(cacheKey);
    if (running) return running;
    const request = host.call('usage', { root: config.profileRoot, executable: config.executable, profileId },
      { hostId, timeoutMs: 30000 }).then(result => {
      const value = { ...result, observedAt: result.observedAt ?? cached?.observedAt ?? null };
      cache.set(cacheKey, value); return value;
    }).finally(() => probes.delete(cacheKey));
    probes.set(cacheKey, request);
    return request;
  }
  async function usage(threadId: string, profileId: string, refresh: boolean): Promise<Usage> {
    const { environment, config } = await context(threadId);
    return hostUsage(environment.hostId, config, profileId, refresh);
  }
  // Anthropic keeps each account's prompt cache separate, so the Cache Hits chip shows cold before the next request.
  async function invalidateCache(threadId: string) {
    try {
      const { plugins } = await bb.sdk.plugins.list();
      if (!plugins.some(item => item.id === 'cache-hits' && item.enabled)) return;
      await bb.sdk.plugins.callRpc({ pluginId: 'cache-hits', method: 'invalidate', input: { threadId },
        outputSchema: z.object({ invalidated: z.boolean() }) });
    } catch (error) {
      bb.log.warn(`Could not mark the prompt cache cold for ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async function select(threadId: string, profileId: string): Promise<Selection> {
    if (switching.has(threadId)) throw new Error('A profile switch is already running.');
    switching.add(threadId);
    try {
      const { thread, environment, config } = await context(threadId);
      requireIdle(thread);
      const profiles = await host.call('profiles', { root: config.profileRoot }, { hostId: environment.hostId });
      const profile = profiles.find(value => value.id === profileId);
      if (!profile) throw new Error('Profile does not exist.');
      const selected = await bb.storage.kv.get<Selection>(key(threadId));
      if (selected?.hostId === environment.hostId && selected.profile.configDir === profile.configDir) return selected;
      await host.call('validate', { root: config.profileRoot, executable: config.executable, profileId }, { hostId: environment.hostId });
      const [identities, environments] = await Promise.all([
        bb.sdk.threads.events.list({ threadId, types: ['thread/identity'], order: 'desc', limit: '1' }),
        bb.sdk.threads.events.list({ threadId, types: ['provider.env-resolved'], order: 'desc', limit: '1' }),
      ]);
      const identity = identities[0];
      const resolved = environments[0];
      const directoryEntry = resolved?.type === 'provider.env-resolved'
        ? resolved.data.entries.find(entry => entry.name === 'CLAUDE_CONFIG_DIR') : undefined;
      if (directoryEntry && typeof directoryEntry.value !== 'string') throw new Error('Current profile directory is masked. Cannot safely identify the source transcript.');
      const sourceDir = directoryEntry && typeof directoryEntry.value === 'string'
        ? directoryEntry.value || null : selected?.profile.configDir ?? null;
      await bb.sdk.threads.stop({ threadId });
      requireIdle(await bb.sdk.threads.get({ threadId }));
      if (identity?.type === 'thread/identity') {
        await host.call('transfer', { root: config.profileRoot, sourceDir, profileId, sessionId: identity.data.providerThreadId },
          { hostId: environment.hostId });
      }
      const value: Selection = { hostId: environment.hostId, profile };
      await bb.storage.kv.set(key(threadId), value);
      // Launches before the switch ran under the old profile, so only later launches are reviewed.
      await bb.storage.kv.set(guardKey(threadId), { checkedSeq: resolved?.seq ?? 0, notice: null } satisfies Guard);
      await invalidateCache(threadId);
      bb.realtime.publish('profiles-changed', { threadId });
      return value;
    } finally { switching.delete(threadId); }
  }
  async function localProfiles() {
    const hostId = await localHostId();
    if (!hostId) return null;
    return host.call('profiles', { root: (await settings.get()).profileRoot }, { hostId });
  }
  bb.rpc.register(accountsContract, {
    accounts: async ({ threadId }) => {
      const unsupported = { supported: false, profiles: [], currentId: 'default' };
      if (threadId === null) {
        const profiles = await localProfiles();
        return profiles ? { supported: true, profiles, currentId: await bb.storage.kv.get<string>(nextKey) ?? 'default' } : unsupported;
      }
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.providerId !== 'claude-code' || !thread.environmentId) return unsupported;
      const { environment, config } = await context(threadId);
      return { supported: true, profiles: await host.call('profiles', { root: config.profileRoot }, { hostId: environment.hostId }),
        currentId: (await bb.storage.kv.get<Selection>(key(threadId)))?.profile.id ?? 'default' };
    },
    choose: async ({ threadId, profileId }) => {
      if (threadId !== null) return { currentId: (await select(threadId, profileId)).profile.id };
      if (!(await localProfiles())?.some(profile => profile.id === profileId)) throw new Error('Profile does not exist.');
      await bb.storage.kv.set(nextKey, profileId);
      bb.realtime.publish('profiles-changed', { threadId: null });
      return { currentId: profileId };
    },
    usage: input => usage(input.threadId, input.profileId, input.refresh),
  });
  bb.rpc.register(usageSourceContract, {
    'provider-usage.v1.listResources': async () => {
      const config = await settings.get();
      const hosts = await bb.sdk.hosts.list();
      const groups = await Promise.all(hosts.map(async machine => {
        const inventoryKey = `inventory:${JSON.stringify([machine.id, config.profileRoot])}`;
        let profiles = await bb.storage.kv.get<Profile[]>(inventoryKey) ?? [];
        if (machine.status === 'connected') {
          try {
            profiles = await host.call('profiles', { root: config.profileRoot }, { hostId: machine.id });
            await bb.storage.kv.set(inventoryKey, profiles);
          } catch { bb.log.warn(`Could not list Claude profiles on host ${machine.id}.`); }
        }
        return profiles.map(profile => ({
          id: JSON.stringify([machine.id, config.profileRoot, profile.id]), accountKey: null,
          providerId: 'claude-code', label: `Claude · ${profile.label}`,
          scope: { kind: 'host' as const, hostId: machine.id, hostName: machine.name },
        }));
      }));
      return { resources: groups.flat() };
    },
    'provider-usage.v1.getResource': async input => {
      const [hostId, root, profileId] = decodeResourceId(input.resourceId);
      const config = await settings.get();
      if (root !== config.profileRoot) throw new Error('Profile root changed. Refresh the resource list.');
      try { return measurement(await hostUsage(hostId, config, profileId, input.refresh)); }
      catch { return measurement({ status: 'error', windows: [], observedAt: null, message: 'Could not reach this profile host.' }); }
    },
  }, { experimental_discoverable: true, experimental_description: 'Claude profile quota through native CLI authentication.' });
  bb.cli.register({ name: 'claude-profiles', summary: 'Choose a Claude profile for an idle thread, read quota or migrate model favourites',
    async run(argv) {
      try {
        if (argv[0] === 'migrate-favourites') {
          if (argv.length > 1) throw new Error('migrate-favourites takes no arguments.');
          return await models.migrateFavourites();
        }
        const [command, threadId, profileId, ...extra] = argv;
        if (extra.length || !threadId || (command !== 'list' && !profileId)) throw new Error('Usage: bb claude-profiles list THREAD | switch THREAD PROFILE | usage THREAD PROFILE | migrate-favourites');
        let value: unknown;
        if (command === 'list') {
          if (profileId) throw new Error('list takes only a thread ID.');
          const { environment, config } = await context(threadId);
          value = await host.call('profiles', { root: config.profileRoot }, { hostId: environment.hostId });
        } else if (command === 'switch' && profileId) value = await select(threadId, profileId);
        else if (command === 'usage' && profileId) value = await usage(threadId, profileId, true);
        else throw new Error('Unknown command. Use list, switch or usage.');
        return { exitCode: 0, stdout: JSON.stringify(value, null, 2) + '\n' };
      } catch (error) { return { exitCode: 1, stderr: (error instanceof Error ? error.message : 'Profile command failed.') + '\n' }; }
    },
  });
}
