import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import type { Usage } from '../quota.ts';
import type { Measurement } from '../usage-source.ts';
import { sourceSnapshotSchema, type Account, type Header, type Inspection, type Snapshot, type SourceSnapshot, type UsageWindow } from './contract.ts';
import type { Period } from './pace.ts';
import type { ResetCredits } from './reset-credits.ts';

const ownPluginId = 'claude-profiles';
const profileLocatorSchema = z.tuple([z.string(), z.string(), z.string()]);
const nativeLocatorSchema = z.tuple([z.string(), z.string()]);

const NAMED: [RegExp, string, Period][] = [
  [/^(Five-hour limit|Five hours|Current session|5h)$/u, '5-hour', 'five-hour'],
  [/^(Daily limit|Daily)$/u, 'Daily', 'day'],
  [/^(Weekly limit|Weekly|Seven days|7d)$/u, 'Weekly', 'week'],
  [/^(Monthly limit|Monthly)$/u, 'Monthly', 'month'],
];
/** Gives every provider's windows one vocabulary and the period that pace needs. */
function describeWindow(window: Omit<UsageWindow, 'period'>): UsageWindow {
  for (const [pattern, label, period] of NAMED) if (pattern.test(window.label)) return { ...window, label, period };
  const scoped = /^Weekly · (.+)$/u.exec(window.label);
  if (scoped?.[1]) return { ...window, label: `Weekly · ${scoped[1].charAt(0).toUpperCase()}${scoped[1].slice(1)}`, period: 'week' };
  return { ...window, period: null };
}

function describeAccounts(snapshot: SourceSnapshot): Snapshot {
  return { machines: snapshot.machines.map(machine => ({ ...machine, providers: machine.providers.map(account => ({ ...account,
    usage: account.usage?.status === 'ok' ? { ...account.usage, windows: account.usage.windows.map(describeWindow) } : account.usage,
  })) })) };
}

/**
 * The default Claude profile reads the same login as BB's native Claude source, so one
 * account appears twice. Keep the native reading (it knows the plan and email) and add
 * the windows only the profile reports.
 */
function foldDefaultProfile(providers: Account[]): Account[] {
  const profileOf = (account: Account) => {
    if (!account.id.startsWith('claude-profiles:')) return null;
    const locator = profileLocatorSchema.safeParse(resourceLocator(account));
    return locator.success ? locator.data[2] : null;
  };
  const named = providers.map(account => {
    const profile = profileOf(account);
    return profile === null ? account : { ...account, accountLabel: profile === 'default' ? 'Default' : profile };
  });
  const fallback = named.find(account => profileOf(account) === 'default');
  const native = named.find(account => account.providerId === 'claude-code' && !account.id.startsWith('claude-profiles:'));
  if (!fallback || !native) return named;
  if (native.usage?.status !== 'ok') return named.filter(account => account !== native);
  const known = new Set(native.usage.windows.map(window => window.label));
  const extra = fallback.usage?.status === 'ok' ? fallback.usage.windows.filter(window => !known.has(window.label)) : [];
  const merged: Account = { ...native, accountLabel: 'Default', usage: { ...native.usage, windows: [...native.usage.windows, ...extra] } };
  // The merged account takes the profile's place so Default leads its profiles.
  return named.flatMap(account => account === native ? [] : account === fallback ? [merged] : [account]);
}

function resourceLocator(account: Pick<Account, 'id'>): unknown {
  try { return JSON.parse(account.id.slice(account.id.indexOf(':') + 1)); }
  catch { return null; }
}

export interface UsagePorts {
  callRpc: BbPluginApi['sdk']['plugins']['callRpc'];
  getThread(input: { threadId: string }): Promise<{ providerId: string; environmentId: string | null }>;
  getEnvironment(input: { environmentId: string }): Promise<{ hostId: string }>;
  listProviders(): Promise<{ id: string; displayName: string }[]>;
  resetCredits(hostId: string, refresh: boolean): Promise<ResetCredits>;
  /** The profile a Claude thread runs on and its quota, or null before the thread has an environment. */
  claudeAccount(threadId: string): Promise<{ label: string; usage: Usage } | null>;
  /** This plugin's own `provider-usage.v1.getResource`, read without an RPC round trip to itself. */
  claudeResource(resourceId: string, refresh: boolean): Promise<Measurement>;
}

export function createUsageReader(ports: UsagePorts) {
  const read = (providerIds: string[], machineIds: string[] | null, refresh: boolean) => ports.callRpc({
    pluginId: 'bb--provider-usage', method: 'getUsage', outputSchema: sourceSnapshotSchema,
    input: { force: refresh, machineIds, providerIds, maxAgeMs: refresh ? 0 : 120_000 },
    signal: AbortSignal.timeout(60_000),
  });
  async function collectOverview(refresh: boolean) {
    const inventory = await read([], null, false);
    const providerIds = [...new Set(inventory.machines.flatMap(machine => machine.providers.map(account => account.providerId)))];
    return describeAccounts(providerIds.length ? await read(providerIds, null, refresh) : inventory);
  }
  function fold(snapshot: Snapshot): Snapshot {
    return { machines: snapshot.machines.map(machine => ({ ...machine, providers: foldDefaultProfile(machine.providers) })) };
  }
  async function overview(refresh: boolean) { return fold(await collectOverview(refresh)); }
  async function inspection(refresh: boolean): Promise<Inspection> {
    let raw = await collectOverview(refresh);
    const observationSchema = z.object({ observedAt: z.number().nonnegative().nullable(),
      usage: sourceSnapshotSchema.shape.machines.element.shape.providers.element.shape.usage });
    const [observations, resetCredits] = await Promise.all([
      Promise.all(raw.machines.flatMap(machine => machine.providers.map(async account => {
        const separator = account.id.indexOf(':');
        let observedAt: number | null = null;
        let usage: Account['usage'] = null;
        if (machine.status === 'connected' && account.usage?.status === 'ok' && separator > 0) {
          try {
            const pluginId = account.id.slice(0, separator);
            const resourceId = account.id.slice(separator + 1);
            const value = pluginId === ownPluginId ? observationSchema.parse(await ports.claudeResource(resourceId, false))
              : await ports.callRpc({ pluginId, method: 'provider-usage.v1.getResource', input: { resourceId, refresh: false },
                outputSchema: observationSchema, signal: AbortSignal.timeout(15_000) });
            if (value.usage?.status === 'ok') {
              observedAt = value.observedAt;
              usage = { ...value.usage, windows: value.usage.windows.map(describeWindow) };
            }
          } catch { /* A source without observation metadata leaves its reading age unknown. */ }
        }
        return { accountId: account.id, observedAt, usage };
      }))),
      Promise.all(raw.machines.filter(machine => machine.providers.some(account => account.providerId === 'codex')).map(async machine => {
        let reading: ResetCredits;
        if (machine.status === 'disconnected') reading = { status: 'unavailable', message: 'Machine is offline.' };
        else {
          try { reading = await ports.resetCredits(machine.id, refresh); }
          catch { reading = { status: 'unavailable', message: 'Reset credits could not be read from this machine.' }; }
        }
        return { hostId: machine.id, reading };
      })),
    ]);
    // A source may refresh while the collector snapshot stays cached. Pair its timestamp with its own figures.
    raw = { machines: raw.machines.map(machine => ({ ...machine, providers: machine.providers.map(account => ({ ...account,
      usage: observations.find(value => value.accountId === account.id)?.usage ?? account.usage,
    })) })) };
    const snapshot = fold(raw);
    const readings = snapshot.machines.flatMap(machine => machine.providers.map(account => {
      const native = observations.find(value => value.accountId === account.id)?.observedAt ?? null;
      if (account.providerId !== 'claude-code' || account.accountLabel !== 'Default' || account.id.startsWith('claude-profiles:'))
        return { accountId: account.id, observedAt: native };
      const source = raw.machines.find(value => value.id === machine.id)?.providers.find(value => {
        const locator = profileLocatorSchema.safeParse(resourceLocator(value));
        return value.id.startsWith('claude-profiles:') && locator.success && locator.data[2] === 'default';
      });
      const profile = source ? observations.find(value => value.accountId === source.id)?.observedAt ?? null : native;
      return { accountId: account.id, observedAt: native === null || profile === null ? null : Math.min(native, profile) };
    }));
    return { snapshot, readings, resetCredits };
  }
  async function header(threadId: string): Promise<Header> {
    const thread = await ports.getThread({ threadId });
    const providers = await ports.listProviders();
    const label = providers.find(provider => provider.id === thread.providerId)?.displayName ?? thread.providerId;
    const base = { providerId: thread.providerId, label, accountLabel: null, windows: [] };
    const claude = thread.providerId === 'claude-code' ? await ports.claudeAccount(threadId) : null;
    if (claude) {
      const { label: accountLabel, usage } = claude;
      return { ...base, accountLabel,
        windows: usage.windows.filter(window => window.id === 'five_hour' || window.id === 'seven_day').map(window => describeWindow({
          label: window.id === 'five_hour' ? '5h' : '7d', usedPercent: window.usedPercent, resetsAt: window.resetsAt, cost: null,
        })), message: usage.status !== 'ok' ? usage.message ?? 'Usage unavailable' : null };
    }
    if (!thread.environmentId) return { ...base, message: 'Usage unavailable' };
    const environment = await ports.getEnvironment({ environmentId: thread.environmentId });
    const snapshot = await read([thread.providerId], [environment.hostId], false);
    const accounts = snapshot.machines.find(machine => machine.id === environment.hostId)?.providers.filter(account => account.providerId === thread.providerId) ?? [];
    const account = accounts.find(account => {
      const locator = nativeLocatorSchema.safeParse(resourceLocator(account));
      return locator.success && locator.data[1] === thread.providerId;
    }) ?? (accounts.length === 1 ? accounts[0] : undefined);
    return { ...base, accountLabel: account?.usage?.status === 'ok' ? account.usage.accountEmail : null,
      windows: account?.usage?.status === 'ok' ? account.usage.windows.map(describeWindow) : [],
      message: account?.usage?.status === 'ok' ? (account.usage.windows.length ? null : 'No limits reported') : 'Usage unavailable' };
  }
  return { overview, header, inspection };
}
