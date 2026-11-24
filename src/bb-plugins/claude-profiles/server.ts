import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { accountsContract, hostContract, usageSourceContract, type HistoryConflict, type Profile, type Selection } from './contracts.ts';
import { assignKeys, type AccountKeys } from './src/accounts/keys.ts';
import { providerEnv } from './src/accounts/claude.ts';
import { initialGuard, profileApplied, reviewLaunch, type Guard } from './src/accounts/guard.ts';
import type { Usage } from './src/accounts/quota.ts';
import { createQuotaCache } from './src/accounts/quota-cache.ts';
import { newThreadAccount, startingThread } from './src/accounts/routing.ts';
import { codexResetContract } from './src/accounts/usage/codex-reset.ts';
import { registerUsage } from './src/accounts/usage/server.ts';
import { createLogin } from './src/accounts/usage/login.ts';
import { decodeResourceId, measurement } from './src/accounts/usage-source.ts';
import { createAmpSource } from './src/accounts/usage/amp-source.ts';
import { createGrokSource } from './src/accounts/usage/grok-source.ts';
import { createAntigravitySource } from './src/accounts/usage/antigravity-source.ts';
import { registerModels } from './src/models/server.ts';
import { registerConnectors } from './src/accounts/connectors.ts';
import { antigravityAccountLabel, parseAntigravityLabels } from './src/accounts/antigravity-labels.ts';
import { antigravityAccountId } from './src/accounts/antigravity-account.ts';
export { rpcContract } from './contracts.ts';

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    profileRoot: { type: 'string', label: 'Claude profile root on each host', default: '~/.claude-profiles/code' },
    antigravityAccountLabels: { type: 'string', label: 'Antigravity account labels (JSON keyed by account ID)', default: '{}' },
    executable: { type: 'string', label: 'Native Claude executable', default: 'claude' },
  });
  registerModels(bb);
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const grok = createGrokSource(hostId => host.call('grokUsage', {}, { hostId, timeoutMs: 20_000 }));
  const antigravity = createAntigravitySource((hostId, accountId) => host.call('antigravityUsage', { accountId }, { hostId, timeoutMs: 30_000 }));
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
  function requireIdle(thread: Awaited<ReturnType<typeof bb.sdk.threads.get>>, allowQueued = false) {
    const idleStatus = ['idle', 'error'].includes(thread.status) || (Boolean(thread.archivedAt) && thread.status === 'pending');
    if (!idleStatus || thread.activeBackgroundAgentCount || (!allowQueued && thread.queuedMessageCount)) {
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
  // A switch chosen during a turn waits here until the runtime is idle.
  type Pending = { profileId: string; label: string; error: string | null };
  const pendingKey = (threadId: string) => `pending:${threadId}`;
  const applying = new Set<string>();
  // BB can still report idle while a turn starts on a warm runtime, so the latest turn event decides too.
  async function turnOpen(threadId: string) {
    const [latest] = await bb.sdk.threads.events.list({ threadId, types: ['turn/started', 'turn/completed'], order: 'desc', limit: '1' });
    return latest?.type === 'turn/started';
  }
  const quiet = async (threadId: string, thread: { status: string; activeBackgroundAgentCount?: number | null }) =>
    ['idle', 'error'].includes(thread.status) && !thread.activeBackgroundAgentCount && !await turnOpen(threadId);
  async function queueSwitch(threadId: string, profileId: string, replace: boolean) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (await quiet(threadId, thread) && !thread.queuedMessageCount) {
      await bb.storage.kv.delete(pendingKey(threadId));
      const result = await select(threadId, profileId, { replace });
      return 'conflict' in result
        ? { currentId: (await bb.storage.kv.get<Selection>(key(threadId)))?.profile.id ?? 'default', conflict: result.conflict }
        : { currentId: result.profile.id, conflict: null };
    }
    const current = (await bb.storage.kv.get<Selection>(key(threadId)))?.profile.id ?? 'default';
    if (profileId === current) await bb.storage.kv.delete(pendingKey(threadId));
    else {
      const { environment, config } = await context(threadId);
      const profiles = await host.call('profiles', { root: config.profileRoot }, { hostId: environment.hostId });
      const profile = profiles.find(value => value.id === profileId);
      if (!profile) throw new Error('Profile does not exist.');
      await bb.storage.kv.set(pendingKey(threadId), { profileId, label: profile.label, error: null } satisfies Pending);
    }
    bb.realtime.publish('profiles-changed', { threadId });
    return { currentId: current, conflict: null };
  }
  async function applyPending(threadId: string) {
    const pending = await bb.storage.kv.get<Pending>(pendingKey(threadId));
    if (!pending || pending.error || applying.has(threadId) || switching.has(threadId)) return;
    if (!await quiet(threadId, await bb.sdk.threads.get({ threadId }))) return;
    applying.add(threadId);
    try {
      const result = await select(threadId, pending.profileId, { allowQueued: true });
      if ('conflict' in result) throw new Error(conflictMessage(result.conflict));
      await bb.storage.kv.delete(pendingKey(threadId));
    } catch (error) {
      await bb.storage.kv.set(pendingKey(threadId), { ...pending, error: error instanceof Error ? error.message : String(error) } satisfies Pending);
    } finally {
      applying.delete(threadId);
      void bb.experimental_hooks.recheck('message.dispatch');
    }
  }
  bb.experimental_hooks.on('message.dispatch', async input => {
    if (input.thread.providerId === 'claude-code' && input.attempt === 'start-turn') {
      const pending = await bb.storage.kv.get<Pending>(pendingKey(input.thread.id));
      if (pending?.error) {
        await bb.storage.kv.delete(pendingKey(input.thread.id));
        return { action: 'reject', message: `Could not move to ${pending.label}: ${pending.error}` };
      }
      if (pending) {
        // Never hold the server-wide hook lock for the transfer; run it beside the hook.
        void applyPending(input.thread.id);
        return { action: 'wait', reason: `Moving to ${pending.label}…`, sendAt: Date.now() + 2000 };
      }
    }
    if (input.thread.providerId === 'claude-code' && (connectors.changing || switching.has(input.thread.id))) {
      return { action: 'wait', reason: 'Applying Claude account settings…', sendAt: Date.now() + 2000 };
    }
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
      const decision = await connectors.beforeDispatch(input.thread.id, input.attempt);
      if (decision) return { action: decision.action, reason: decision.reason, sendAt: decision.sendAt };
    }
    return { action: 'proceed' };
  });
  bb.events.on('experimental_thread.events', async ({ thread }) => {
    if (thread.providerId !== 'claude-code') return;
    await applyPending(thread.id).catch(error => bb.log.warn(`Pending account switch failed: ${String(error)}`));
    await connectors.settle(thread.id).catch(error => bb.log.warn(`Connector restart review failed: ${error instanceof Error ? error.message : String(error)}`));
    await settleStage(thread).catch(error => bb.log.warn(`Could not remove the fork stage for ${thread.id}: ${error instanceof Error ? error.message : String(error)}`));
    await review(thread.id).catch(error => bb.log.warn(`Claude profile review failed for ${thread.id}: ${error instanceof Error ? error.message : String(error)}`));
  });
  bb.providers.experimental_contributeEnv('claude-code', async input => {
    // A launch outside a thread has no account binding, like a Default thread.
    if (input.threadId === null) return [];
    const selected = await bb.storage.kv.get<Selection>(key(input.threadId));
    const accountEnv = selected?.hostId === input.hostId ? providerEnv(selected.profile.configDir) : [];
    // A ccp launch materialises the profile from ~/.claude; BB launches skip ccp, so the same step runs here.
    // It shares BB's five-second contribution budget, and a failure leaves the profile as it was.
    const materialised = selected && accountEnv.length > 0
      ? host.call('materialise', { root: (await settings.get()).profileRoot, profileId: selected.profile.id },
        { hostId: input.hostId, timeoutMs: 3500 })
        .catch(error => bb.log.warn(`Could not materialise the ${selected.profile.label} profile: ${error instanceof Error ? error.message : String(error)}`))
      : undefined;
    // Connector lookup must finish within BB's five-second contribution budget so account routing survives a failure.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connectorEnv = Promise.race([
      connectors.env(input.threadId, input.hostId),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Connector lookup timed out')), 1000); }),
    ]).catch(error => {
      bb.log.warn(`Account connectors use the BB default: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }).finally(() => clearTimeout(timer));
    const [connectorEntries] = await Promise.all([connectorEnv, materialised]);
    return [...accountEnv, ...connectorEntries];
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
  const conflictMessage = (conflict: HistoryConflict) =>
    `${conflict.label} has a different copy of this conversation. Choose ${conflict.label} in the switcher to compare and replace it.`;
  async function select(threadId: string, profileId: string,
    options: { allowQueued?: boolean; replace?: boolean; allowMissing?: boolean; skipValidate?: boolean; fallbackHostId?: string } = {}): Promise<Selection | { conflict: HistoryConflict }> {
    const { allowQueued = false, replace = false, allowMissing = false } = options;
    if (connectors.changing || switching.has(threadId)) throw new Error('Claude session settings are changing.');
    switching.add(threadId);
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.providerId !== 'claude-code') throw new Error('This thread does not use Claude Code.');
      const hostId = thread.environmentId
        ? (await bb.sdk.environments.get({ environmentId: thread.environmentId })).hostId
        : options.fallbackHostId ?? null;
      if (!hostId) throw new Error('Send the first message before choosing a profile.');
      const config = await settings.get();
      requireIdle(thread, allowQueued);
      const profiles = await host.call('profiles', { root: config.profileRoot }, { hostId });
      const profile = profiles.find(value => value.id === profileId);
      if (!profile) throw new Error('Profile does not exist.');
      const selected = await bb.storage.kv.get<Selection>(key(threadId));
      if (selected?.hostId === hostId && selected.profile.configDir === profile.configDir) return selected;
      if (!options.skipValidate) {
        await host.call('validate', { root: config.profileRoot, executable: config.executable, profileId }, { hostId });
      }
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
      if (thread.environmentId) {
        await bb.sdk.threads.stop({ threadId });
        requireIdle(await bb.sdk.threads.get({ threadId }), allowQueued);
      }
      await connectors.invalidate(threadId);
      if (identity?.type === 'thread/identity') {
        const transfer = await host.call('transfer', { root: config.profileRoot, sourceDir, profileId,
          sessionId: identity.data.providerThreadId, replace, ...(allowMissing ? { allowMissing: true } : {}) }, { hostId });
        if (transfer.status === 'diverged') {
          return { conflict: { profileId, label: profile.label, source: transfer.source, target: transfer.target } };
        }
      }
      const value: Selection = { hostId, profile };
      await bb.storage.kv.set(key(threadId), value);
      // Launches before the switch ran under the old profile, so only later launches are reviewed.
      await bb.storage.kv.set(guardKey(threadId), { checkedSeq: resolved?.seq ?? 0, notice: null } satisfies Guard);
      // Release only after the thread points at the target, so a failed save still finds its history.
      if (identity?.type === 'thread/identity') {
        try {
          await host.call('release', { root: config.profileRoot, sourceDir, profileId, sessionId: identity.data.providerThreadId },
            { hostId });
        } catch (error) {
          bb.log.warn(`Kept the ${threadId} history copy in the previous account: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await invalidateCache(threadId);
      bb.realtime.publish('profiles-changed', { threadId });
      return value;
    } finally { switching.delete(threadId); }
  }
  async function migrateProfiles(fromId: string, toId: string, options: { includeArchived: boolean; rebindMissing: boolean; dryRun: boolean }) {
    if (fromId === toId) throw new Error('Source and target accounts must differ.');
    const config = await settings.get();
    const entries = (await bb.storage.kv.list('thread:')).sort();
    const bound: { threadId: string; selected: Selection }[] = [];
    for (const entry of entries) {
      const selected = await bb.storage.kv.get<Selection>(entry);
      if (selected?.profile.id === fromId) bound.push({ threadId: entry.slice('thread:'.length), selected });
    }
    let nextUpdated = false;
    if ((await bb.storage.kv.get<string>(nextKey)) === fromId) {
      if (!(await localProfiles())?.some(profile => profile.id === toId)) throw new Error('Profile does not exist.');
      if (!options.dryRun) await chooseNext(toId);
      nextUpdated = true;
    }
    const hostProfiles = new Map<string, Profile[]>();
    const hostValidation = new Map<string, string | null>();
    const migrated: string[] = [];
    const conflicts: { threadId: string; label: string }[] = [];
    const skipped: { threadId: string; reason: string }[] = [];
    const failed: { threadId: string; error: string }[] = [];
    let archivedSkipped = 0;
    for (const { threadId, selected } of bound) {
      let thread: Awaited<ReturnType<typeof bb.sdk.threads.get>>;
      try { thread = await bb.sdk.threads.get({ threadId }); }
      catch { skipped.push({ threadId, reason: 'Thread no longer exists.' }); continue; }
      if (thread.providerId !== 'claude-code') { skipped.push({ threadId, reason: 'Thread does not use Claude Code.' }); continue; }
      if (thread.archivedAt && !options.includeArchived) { archivedSkipped += 1; continue; }
      const allowQueued = Boolean(thread.archivedAt);
      const idle = thread.archivedAt && thread.status === 'pending'
        ? !thread.activeBackgroundAgentCount
        : await quiet(threadId, thread);
      if (!idle || (!allowQueued && thread.queuedMessageCount)) {
        skipped.push({ threadId, reason: 'Thread is active or has queued messages.' });
        continue;
      }
      const hostId = thread.environmentId
        ? (await bb.sdk.environments.get({ environmentId: thread.environmentId })).hostId
        : selected.hostId;
      let profiles = hostProfiles.get(hostId);
      if (!profiles) {
        try {
          profiles = await host.call('profiles', { root: config.profileRoot }, { hostId });
          hostProfiles.set(hostId, profiles);
        } catch (error) {
          failed.push({ threadId, error: error instanceof Error ? error.message : String(error) });
          continue;
        }
      }
      if (!profiles.some(profile => profile.id === toId)) {
        failed.push({ threadId, error: `Profile ${toId} does not exist on host ${hostId}.` });
        continue;
      }
      if (options.dryRun) { migrated.push(threadId); continue; }
      if (!hostValidation.has(hostId)) {
        try {
          await host.call('validate', { root: config.profileRoot, executable: config.executable, profileId: toId }, { hostId });
          hostValidation.set(hostId, null);
        } catch (error) {
          hostValidation.set(hostId, error instanceof Error ? error.message : String(error));
        }
      }
      const validationError = hostValidation.get(hostId);
      if (validationError) { failed.push({ threadId, error: validationError }); continue; }
      try {
        const result = await select(threadId, toId, { allowQueued, allowMissing: options.rebindMissing, skipValidate: true, fallbackHostId: selected.hostId });
        if ('conflict' in result) conflicts.push({ threadId, label: result.conflict.label });
        else migrated.push(threadId);
      } catch (error) {
        failed.push({ threadId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { from: fromId, to: toId, dryRun: options.dryRun, nextUpdated, archivedSkipped, migrated, conflicts, skipped, failed };
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
      const result = await select(thread.id, source.profileId);
      if ('conflict' in result) throw new Error(conflictMessage(result.conflict));
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
  async function accountKeys(profiles: readonly Profile[] = []) {
    const saved = await bb.storage.kv.get<AccountKeys>('account-keys') ?? {};
    const { keys, changed } = assignKeys(saved, profiles);
    if (changed) await bb.storage.kv.set('account-keys', keys);
    return keys;
  }
  async function keyed(profiles: readonly Profile[]) {
    const keys = await accountKeys(profiles);
    return profiles.map(profile => ({ ...profile, key: keys[profile.id] ?? null }));
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
  // A handoff draft's send creates a new Claude thread, which claims the remembered choice like a new-thread draft.
  async function handoff(threadId: string) {
    return (await bb.sdk.threads.get({ threadId })).providerId !== 'claude-code';
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
    if (antigravity.owns(resourceId)) return antigravity.read(resourceId, refresh);
    if (grok.owns(resourceId)) return grok.read(resourceId, refresh);
    const [hostId, root, profileId] = decodeResourceId(resourceId);
    const config = await settings.get();
    if (root !== config.profileRoot) throw new Error('Profile root changed. Refresh the resource list.');
    try { return measurement(await hostUsage(hostId, config, profileId, refresh)); }
    catch { return measurement({ status: 'error', windows: [], observedAt: null, message: 'Could not reach this profile host.' }); }
  }
  bb.rpc.register(codexResetContract, {
    'codexReset.status': ({ hostId }) => host.call('codexReset', { command: 'status' }, { hostId }),
    'codexReset.set': ({ hostId, action }) => host.call('codexReset', { command: 'set', action }, { hostId, timeoutMs: 50_000 }),
  });
  bb.background.schedule('codex-auto-reset', '*/5 * * * *', async () => {
    const machines = (await bb.sdk.hosts.list()).filter(machine => machine.status === 'connected');
    await Promise.all(machines.map(async machine => {
      const options = { hostId: machine.id, timeoutMs: 50_000 };
      // Check only hosts with an armed local controller. Recheck mode under the CLI's lock.
      const status = await host.call('codexReset', { command: 'status' }, options).catch(() => null);
      if (status && status.mode !== 'off') await host.call('codexReset', { command: 'check' }, options);
    }));
  });
  const usageReader = registerUsage(bb, {
    antigravityLabels: async () => parseAntigravityLabels((await settings.get()).antigravityAccountLabels),
    login: createLogin({ terminals: bb.sdk.terminals, config: () => settings.get(), hosts: () => bb.sdk.hosts.list(),
      profiles: (hostId, root) => host.call('profiles', { root }, { hostId }) }),
    amp: refresh => amp.read(refresh),
    resetCredits: (hostId, refresh) => host.call('resetCredits', { refresh }, { hostId, timeoutMs: 30_000 }),
    claudeResets: async (hostId, profileId, refresh) => host.call('claudeResets',
      { root: (await settings.get()).profileRoot, profileId, refresh }, { hostId, timeoutMs: 30_000 }),
    claudeAccount: async threadId => {
      const account = await threadAccount(threadId);
      if (!account) return null;
      return { label: account.profiles.find(value => value.id === account.currentId)?.label ?? 'Default',
        usage: await hostUsage(account.hostId, account.config, account.currentId, false) };
    },
    claudeResource: async (id, refresh) => antigravity.owns(id) && !refresh
      ? antigravity.lastReading(id) ?? readResource(id, refresh)
      : readResource(id, refresh),
  });
  bb.rpc.register(accountsContract, {
    antigravityAccounts: async ({ hostId }) => {
      const providers = await bb.sdk.providers.list({ hostId });
      const labels = parseAntigravityLabels((await settings.get()).antigravityAccountLabels);
      const profiles = providers.filter(provider => antigravityAccountId(provider.id) !== null && provider.available).map(provider => ({
        id: provider.id, label: antigravityAccountLabel(antigravityAccountId(provider.id)!, provider.displayName, labels),
        configDir: null,
      }));
      const saved = await bb.storage.kv.get<AccountKeys>('antigravity-account-keys') ?? {};
      const assigned = assignKeys(saved, profiles);
      if (assigned.changed) await bb.storage.kv.set('antigravity-account-keys', assigned.keys);
      return profiles.map(profile => ({ ...profile, key: assigned.keys[profile.id] ?? null }));
    },
    antigravityQuota: async ({ hostId, providerId }) => {
      const accountId = antigravityAccountId(providerId);
      if (accountId === null) throw new Error('Invalid Antigravity account.');
      const resourceId = JSON.stringify(accountId === 'default' ? ['antigravity', hostId] : ['antigravity', hostId, accountId]);
      const value = await antigravity.read(resourceId, false);
      return { status: value.usage.status, windows: value.usage.status === 'ok' ? value.usage.windows : [],
        observedAt: value.observedAt, message: value.usage.status === 'error' ? value.usage.message : null };
    },
    accounts: async ({ threadId }) => {
      const unsupported = { supported: false, target: 'thread' as const, profiles: [], currentId: 'default', pendingId: null };
      if (threadId === null || await handoff(threadId)) {
        const profiles = await localProfiles();
        return profiles ? { supported: true, target: 'next' as const, profiles: await keyed(profiles),
          currentId: await bb.storage.kv.get<string>(nextKey) ?? 'default', pendingId: null } : unsupported;
      }
      const account = await threadAccount(threadId);
      const pending = await bb.storage.kv.get<Pending>(pendingKey(threadId));
      return account ? { supported: true, target: 'thread' as const, profiles: await keyed(account.profiles), currentId: account.currentId,
        pendingId: pending?.profileId ?? null } : unsupported;
    },
    nextThreadQuota: async ({ profileId }) => {
      const hostId = await localHostId();
      if (!hostId) throw new Error('No connected machine to read quota on.');
      return hostUsage(hostId, await settings.get(), profileId, false);
    },
    choose: async ({ threadId, profileId, replace }) => {
      if (threadId !== null && !(await handoff(threadId))) return queueSwitch(threadId, profileId, replace);
      await chooseNext(profileId);
      return { currentId: profileId, conflict: null };
    },
    usage: input => usage(input.threadId, input.profileId, input.refresh),
    threadAccounts: async () => {
      const selections = await Promise.all((await bb.storage.kv.list('thread:')).map(async entry =>
        [entry.slice('thread:'.length), await bb.storage.kv.get<Selection>(entry)] as const));
      const keys = await accountKeys(selections.flatMap(([, selected]) => selected?.profile.configDir ? [selected.profile] : []));
      return selections.flatMap(([threadId, selected]) => selected?.profile.configDir
        ? [{ threadId, profileId: selected.profile.id, label: selected.profile.label, key: keys[selected.profile.id] ?? null }] : []);
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
      const labels = parseAntigravityLabels(config.antigravityAccountLabels);
      const antigravityHosts = (await Promise.all(hosts.map(async machine => {
        try {
          const providers = await bb.sdk.providers.list({ hostId: machine.id });
          const accounts = providers.flatMap(provider => {
            const id = antigravityAccountId(provider.id);
            return id !== null && provider.available ? [{ id, label: antigravityAccountLabel(id, provider.displayName ?? provider.id, labels) }] : [];
          });
          return accounts.length ? [{ ...machine, accounts }] : [];
        } catch { return []; }
      }))).flat();
      return { resources: [...groups.flat(), ...grok.resources(hosts), ...antigravity.resources(antigravityHosts)] };
    },
    'provider-usage.v1.getResource': input => readResource(input.resourceId, input.refresh),
  }, { experimental_discoverable: true, experimental_description: 'Claude, Grok and Antigravity quota through native CLI authentication.' });
  const usageText = 'Usage: bb claude-profiles list THREAD | switch THREAD PROFILE | usage THREAD PROFILE | overview [--refresh] | header THREAD'
    + ' | import SESSION-ID|TMUX-PANE | connectors THREAD [account|off] | next [PROFILE]'
    + ' | migrate FROM TO [--include-archived] [--rebind-missing] [--dry-run]';
  bb.cli.register({ name: 'claude-profiles', summary: 'Choose a Claude profile for an idle thread, read quota and usage',
    async run(argv) {
      try {
        if (argv[0] === 'migrate') {
          const [, fromId, toId, ...flags] = argv;
          if (!fromId || !toId || fromId.startsWith('-') || toId.startsWith('-')) throw new Error(usageText);
          let includeArchived = false;
          let rebindMissing = false;
          let dryRun = false;
          for (const flag of flags) {
            if (flag === '--include-archived') includeArchived = true;
            else if (flag === '--rebind-missing') rebindMissing = true;
            else if (flag === '--dry-run') dryRun = true;
            else throw new Error(usageText);
          }
          const result = await migrateProfiles(fromId, toId, { includeArchived, rebindMissing, dryRun });
          return { exitCode: result.failed.length || result.conflicts.length ? 1 : 0, stdout: JSON.stringify(result, null, 2) + '\n' };
        }
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
        } else if (command === 'switch' && profileId) {
          const { currentId, conflict } = await queueSwitch(threadId, profileId, false);
          value = { currentId, pendingId: (await bb.storage.kv.get<Pending>(pendingKey(threadId)))?.profileId ?? null, conflict };
        }
        else if (command === 'usage' && profileId) value = await usage(threadId, profileId, true);
        else throw new Error('Unknown command. Use list, switch or usage.');
        return { exitCode: 0, stdout: JSON.stringify(value, null, 2) + '\n' };
      } catch (error) { return { exitCode: 1, stderr: (error instanceof Error ? error.message : 'Profile command failed.') + '\n' }; }
    },
  });
}
