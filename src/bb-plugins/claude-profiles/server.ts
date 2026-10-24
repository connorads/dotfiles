import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { accountsContract, hostContract, usageSourceContract, type Profile, type Selection } from './contracts.ts';
import { providerEnv } from './src/accounts/claude.ts';
import { initialGuard, profileApplied, reviewLaunch, type Guard } from './src/accounts/guard.ts';
import type { Usage } from './src/accounts/quota.ts';
import { createQuotaCache } from './src/accounts/quota-cache.ts';
import { newThreadAccount, startingThread } from './src/accounts/routing.ts';
import { registerUsage } from './src/accounts/usage/server.ts';
import { createLogin } from './src/accounts/usage/login.ts';
import { decodeResourceId, measurement } from './src/accounts/usage-source.ts';
import { createAmpSource } from './src/accounts/usage/amp-source.ts';
import { createGrokSource } from './src/accounts/usage/grok-source.ts';
import { registerModels } from './src/models/server.ts';
import { registerConnectors } from './src/accounts/connectors.ts';
export { rpcContract } from './contracts.ts';

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    profileRoot: { type: 'string', label: 'Claude profile root on each host', default: '~/.claude-profiles/code' },
    executable: { type: 'string', label: 'Native Claude executable', default: 'claude' },
  });
  registerModels(bb);
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const grok = createGrokSource(hostId => host.call('grokUsage', {}, { hostId, timeoutMs: 20_000 }));
  const amp = createAmpSource(() => bb.sdk.hosts.list(), hostId => host.call('ampUsage', {}, { hostId, timeoutMs: 25_000 }));
  const switching = new Set<string>();
  const connectors = registerConnectors(bb, switching, async (threadId, requestedProfileId) => {
    const hostId = threadId === null ? await localHostId() : (await context(threadId)).environment.hostId;
    if (!hostId) throw new Error('No connected machine to configure account connectors.');
    const selected = threadId === null ? await bb.storage.kv.get<string>(nextKey)
      : (await bb.storage.kv.get<Selection>(key(threadId)))?.profile.id;
    const profileId = requestedProfileId ?? selected ?? 'default';
    if (requestedProfileId !== undefined) {
      const profiles = await host.call('profiles', { root: (await settings.get()).profileRoot }, { hostId });
      if (!profiles.some(profile => profile.id === profileId)) throw new Error('Profile does not exist.');
    }
    return { hostId, profileId };
  });
  const key = (id: string) => `thread:${id}`;
  const nextKey = 'next-thread-profile';
  const guardKey = (id: string) => `guard:${id}`;
  const stageKey = (id: string) => `stage:${id}`;
  const stageLifetimeMs = 10 * 60_000;
  type Stage = { hostId: string; stagedAt: number };
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
  async function claimBinding(thread: Parameters<typeof startingThread>[0] & { id: string },
    parentThreadId: string | null, hostId: string | null) {
    if (await bb.storage.kv.get<Selection>(key(thread.id))) return;
    const starting = startingThread(thread, parentThreadId);
    const startingBinding = starting ? await bb.storage.kv.get<Selection>(key(starting.id)) ?? null : null;
    const defaultWhenUnbound = (!parentThreadId && thread.originKind === 'fork') || (!!starting?.workflow && !startingBinding
      && (await bb.sdk.threads.get({ threadId: starting.id })).providerId === 'claude-code');
    const account = newThreadAccount(startingBinding, await bb.storage.kv.get<string>(nextKey) ?? null, defaultWhenUnbound);
    if (account.kind === 'default' || (account.profileId === 'default' && !hostId)) return;
    if (!hostId) throw new Error('Choose a machine before starting a thread on another Claude account.');
    const config = await settings.get();
    const profile = (await host.call('profiles', { root: config.profileRoot }, { hostId })).find(value => value.id === account.profileId);
    if (!profile) {
      throw new Error(account.kind === 'inherit'
        ? `This thread inherits the ${account.label} account from the thread that started it. That account does not exist on this machine, `
          + 'so the message was not sent. Add the account on this machine, or start the thread from a thread on this machine.'
        : `Claude account ${account.profileId} does not exist on this machine. Choose another account.`);
    }
    await bb.storage.kv.set(key(thread.id), { hostId, profile } satisfies Selection);
    bb.realtime.publish('profiles-changed', { threadId: thread.id });
  }
  async function latestIdentity(threadId: string) {
    const [event] = await bb.sdk.threads.events.list({ threadId, types: ['thread/identity'], order: 'desc', limit: '1' });
    return event?.type === 'thread/identity' ? event.data.providerThreadId : null;
  }
  // BB forks a Claude session outside the account, so the source is staged where BB looks: src/accounts/fork-stage.ts.
  async function stageFork(thread: { id: string; originKind: 'fork' | null; sourceThreadId: string | null }, hostId: string | null) {
    if (thread.originKind !== 'fork' || !thread.sourceThreadId || !hostId) return;
    const selected = await bb.storage.kv.get<Selection>(key(thread.id));
    if (!selected?.profile.configDir) return;
    const sessionId = await latestIdentity(thread.sourceThreadId);
    if (!sessionId) return;
    try {
      await host.call('stageFork', { root: (await settings.get()).profileRoot, profileId: selected.profile.id, sessionId,
        forkThreadId: thread.id }, { hostId, timeoutMs: 5_000 });
    } catch (error) {
      throw new Error(`Could not prepare this fork on the ${selected.profile.label} account: ${error instanceof Error ? error.message : String(error)}`);
    }
    await bb.storage.kv.set(stageKey(thread.id), { hostId, stagedAt: Date.now() } satisfies Stage);
  }
  async function settleStage(thread: { id: string; status: string }) {
    const stage = await bb.storage.kv.get<Stage>(stageKey(thread.id));
    if (!stage) return;
    const forkSessionId = await latestIdentity(thread.id);
    if (!forkSessionId && thread.status !== 'error') return;
    const result = await host.call('unstageFork', { forkThreadId: thread.id, forkSessionId }, { hostId: stage.hostId });
    await bb.storage.kv.delete(stageKey(thread.id));
    if (result.forked === false) bb.log.warn(`Fork ${thread.id} did not write its session into its account. BB's fork path may have changed.`);
  }
  async function sweepStages() {
    for (const machine of (await bb.sdk.hosts.list()).filter(value => value.status === 'connected')) {
      try { await host.call('sweepForkStages', { maxAgeMs: stageLifetimeMs }, { hostId: machine.id }); }
      catch (error) { bb.log.warn(`Could not sweep fork stages on host ${machine.id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    for (const entry of await bb.storage.kv.list('stage:')) {
      const stage = await bb.storage.kv.get<Stage>(entry);
      if (!stage || Date.now() - stage.stagedAt >= stageLifetimeMs) await bb.storage.kv.delete(entry);
    }
  }
  bb.background.schedule('fork-stage-sweep', '*/5 * * * *', sweepStages);
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
    if (input.thread.providerId === 'claude-code' && (connectors.changing || switching.has(input.thread.id))) return { action: 'reject', message: 'Claude session settings are changing. Send your message after they finish.' };
    if (input.thread.providerId === 'claude-code' && input.thread.status === 'pending') {
      try {
        await claimBinding(input.thread, input.parentThreadId, input.host?.id ?? null);
        await stageFork(input.thread, input.host?.id ?? null);
        await connectors.claim(input.thread, input.parentThreadId);
      }
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
      try { await connectors.beforeDispatch(input.thread.id); }
      catch (error) { return { action: 'reject', message: error instanceof Error ? error.message : 'Could not apply connector settings.' }; }
    }
    return { action: 'proceed' };
  });
  bb.events.on('experimental_thread.events', async ({ thread }) => {
    if (thread.providerId !== 'claude-code') return;
    await connectors.settle(thread.id).catch(error => bb.log.warn(`Connector restart review failed: ${error instanceof Error ? error.message : String(error)}`));
    await settleStage(thread).catch(error => bb.log.warn(`Could not remove the fork stage for ${thread.id}: ${error instanceof Error ? error.message : String(error)}`));
    await review(thread.id).catch(error => bb.log.warn(`Claude profile review failed for ${thread.id}: ${error instanceof Error ? error.message : String(error)}`));
  });
  bb.providers.experimental_contributeEnv('claude-code', async input => {
    const selected = await bb.storage.kv.get<Selection>(key(input.threadId));
    const accountEnv = selected?.hostId === input.hostId ? providerEnv(selected.profile.configDir) : [];
    // Connector lookup must finish within BB's five-second contribution budget so account routing survives a failure.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const connectorEnv = await Promise.race([
        connectors.env(input.threadId, input.hostId),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Connector lookup timed out')), 1000); }),
      ]);
      return [...accountEnv, ...connectorEnv];
    } catch (error) {
      bb.log.warn(`Account connectors use the BB default: ${error instanceof Error ? error.message : String(error)}`);
      return accountEnv;
    } finally { clearTimeout(timer); }
  });
  const hostUsage = createQuotaCache((hostId, config, profileId) => host.call('usage',
    { root: config.profileRoot, executable: config.executable, profileId }, { hostId, timeoutMs: 30000 }));
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
    if (connectors.changing || switching.has(threadId)) throw new Error('Claude session settings are changing.');
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
      await connectors.invalidate(threadId);
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
  // BB has no API to bind a thread to an existing session, so a stub thread's own session takes over the history.
  async function importSession(ref: string) {
    const hostId = await localHostId();
    if (!hostId) throw new Error('No connected machine to import on.');
    const config = await settings.get();
    const source = await host.call('locate', { root: config.profileRoot, ref }, { hostId });
    const environment = (await bb.sdk.environments.list({ hostId, path: source.cwd, status: 'ready' }))
      .sort((a, b) => Number(b.environmentProviderId === 'project-checkout') - Number(a.environmentProviderId === 'project-checkout'))[0];
    if (!environment) throw new Error(`No ready BB environment at ${source.cwd}. Add the project to BB first.`);
    const thread = await bb.sdk.threads.spawn({ projectId: environment.projectId, providerId: 'claude-code', title: source.title,
      environment: { type: 'reuse', environmentId: environment.id },
      prompt: 'This thread imports an existing Claude Code session. Reply with only: OK' });
    const failed = (step: string, error: unknown) =>
      new Error(`Import into ${thread.id} stopped at ${step}: ${error instanceof Error ? error.message : String(error)}`);
    try {
      await bb.sdk.threads.wait({ threadId: thread.id, status: 'idle', timeoutMs: 300_000 });
      await select(thread.id, source.profileId);
    } catch (error) { throw failed('the stub turn', error); }
    const [identity] = await bb.sdk.threads.events.list({ threadId: thread.id, types: ['thread/identity'], order: 'desc', limit: '1' });
    if (identity?.type !== 'thread/identity') throw failed('the session ID', 'the stub recorded none');
    try {
      await host.call('adopt', { root: config.profileRoot, profileId: source.profileId,
        sourceSessionId: source.sessionId, sessionId: identity.data.providerThreadId }, { hostId });
    } catch (error) { throw failed('the transcript copy', error); }
    return { threadId: thread.id, title: source.title, profileId: source.profileId,
      sourceSessionId: source.sessionId, sessionId: identity.data.providerThreadId };
  }
  async function localProfiles() {
    const hostId = await localHostId();
    if (!hostId) return null;
    return host.call('profiles', { root: (await settings.get()).profileRoot }, { hostId });
  }
  async function chooseNext(profileId: string) {
    if (!(await localProfiles())?.some(profile => profile.id === profileId)) throw new Error('Profile does not exist.');
    await bb.storage.kv.set(nextKey, profileId);
    bb.realtime.publish('profiles-changed', { threadId: null });
  }
  // A thread without an environment has no host to list profiles on yet.
  async function threadAccount(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.providerId !== 'claude-code' || !thread.environmentId) return null;
    const { environment, config } = await context(threadId);
    return { hostId: environment.hostId, config,
      profiles: await host.call('profiles', { root: config.profileRoot }, { hostId: environment.hostId }),
      currentId: (await bb.storage.kv.get<Selection>(key(threadId)))?.profile.id ?? 'default' };
  }
  async function readResource(resourceId: string, refresh: boolean) {
    if (grok.owns(resourceId)) return grok.read(resourceId, refresh);
    const [hostId, root, profileId] = decodeResourceId(resourceId);
    const config = await settings.get();
    if (root !== config.profileRoot) throw new Error('Profile root changed. Refresh the resource list.');
    try { return measurement(await hostUsage(hostId, config, profileId, refresh)); }
    catch { return measurement({ status: 'error', windows: [], observedAt: null, message: 'Could not reach this profile host.' }); }
  }
  const usageReader = registerUsage(bb, {
    login: createLogin({ terminals: bb.sdk.terminals, config: () => settings.get(), hosts: () => bb.sdk.hosts.list(),
      profiles: (hostId, root) => host.call('profiles', { root }, { hostId }) }),
    amp: refresh => amp.read(refresh),
    resetCredits: (hostId, refresh) => host.call('resetCredits', { refresh }, { hostId, timeoutMs: 30_000 }),
    claudeAccount: async threadId => {
      const account = await threadAccount(threadId);
      if (!account) return null;
      return { label: account.profiles.find(value => value.id === account.currentId)?.label ?? 'Default',
        usage: await hostUsage(account.hostId, account.config, account.currentId, false) };
    },
    claudeResource: readResource,
  });
  bb.rpc.register(accountsContract, {
    accounts: async ({ threadId }) => {
      const unsupported = { supported: false, profiles: [], currentId: 'default' };
      if (threadId === null) {
        const profiles = await localProfiles();
        return profiles ? { supported: true, profiles, currentId: await bb.storage.kv.get<string>(nextKey) ?? 'default' } : unsupported;
      }
      const account = await threadAccount(threadId);
      return account ? { supported: true, profiles: account.profiles, currentId: account.currentId } : unsupported;
    },
    nextThreadQuota: async ({ profileId }) => {
      const hostId = await localHostId();
      if (!hostId) throw new Error('No connected machine to read quota on.');
      return hostUsage(hostId, await settings.get(), profileId, false);
    },
    choose: async ({ threadId, profileId }) => {
      if (threadId !== null) return { currentId: (await select(threadId, profileId)).profile.id };
      await chooseNext(profileId);
      return { currentId: profileId };
    },
    usage: input => usage(input.threadId, input.profileId, input.refresh),
    threadAccounts: async () => {
      const selections = await Promise.all((await bb.storage.kv.list('thread:')).map(async entry =>
        [entry.slice('thread:'.length), await bb.storage.kv.get<Selection>(entry)] as const));
      return selections.flatMap(([threadId, selected]) => selected?.profile.configDir
        ? [{ threadId, profileId: selected.profile.id, label: selected.profile.label }] : []);
    },
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
      return { resources: [...groups.flat(), ...grok.resources(hosts)] };
    },
    'provider-usage.v1.getResource': input => readResource(input.resourceId, input.refresh),
  }, { experimental_discoverable: true, experimental_description: 'Claude profile and Grok quota through native CLI authentication.' });
  const usageText = 'Usage: bb claude-profiles list THREAD | switch THREAD PROFILE | usage THREAD PROFILE | overview [--refresh] | header THREAD'
    + ' | import SESSION-ID|TMUX-PANE | connectors THREAD [account|off] | next [PROFILE]';
  bb.cli.register({ name: 'claude-profiles', summary: 'Choose a Claude profile for an idle thread, read quota and usage',
    async run(argv) {
      try {
        if (argv[0] === 'connectors') {
          const [, threadId, value] = argv;
          if (!threadId || argv.length > 3 || (value !== undefined && value !== 'account' && value !== 'off')) throw new Error(usageText);
          const result = value === undefined ? await connectors.state(threadId) : await connectors.set(threadId, value);
          return { exitCode: 0, stdout: JSON.stringify(result, null, 2) + '\n' };
        }
        if (argv[0] === 'overview' || argv[0] === 'header') {
          const valid = argv[0] === 'overview' ? argv.length === 1 || (argv.length === 2 && argv[1] === '--refresh') : argv.length === 2;
          if (!valid) throw new Error(usageText);
          const value = argv[0] === 'overview' ? await usageReader.overview(argv.length === 2) : await usageReader.header(argv[1]!);
          return { exitCode: 0, stdout: JSON.stringify(value, null, 2) + '\n' };
        }
        if (argv[0] === 'next') {
          if (argv.length > 2) throw new Error(usageText);
          if (argv[1]) await chooseNext(argv[1]);
          const profiles = await localProfiles();
          if (!profiles) throw new Error('No connected machine to list Claude profiles on.');
          const value = { currentId: await bb.storage.kv.get<string>(nextKey) ?? 'default', profiles: profiles.map(profile => profile.id) };
          return { exitCode: 0, stdout: JSON.stringify(value, null, 2) + '\n' };
        }
        if (argv[0] === 'import') {
          if (argv.length !== 2) throw new Error(usageText);
          return { exitCode: 0, stdout: JSON.stringify(await importSession(argv[1]!), null, 2) + '\n' };
        }
        const [command, threadId, profileId, ...extra] = argv;
        if (extra.length || !threadId || (command !== 'list' && !profileId)) throw new Error(usageText);
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
