import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { rpcContract, sourceSnapshotSchema, type Account, type Header, type Snapshot, type SourceSnapshot, type UsageWindow } from './contracts.ts';
import type { Period } from './pace.ts';

const profileThreadSchema = z.object({
  supported: z.boolean(), currentId: z.string(), profiles: z.array(z.object({ id: z.string(), label: z.string() })),
});
const profileUsageSchema = z.object({
  status: z.enum(['ok', 'unavailable', 'unauthenticated', 'error']), message: z.string().nullable(),
  windows: z.array(z.object({ id: z.string(), usedPercent: z.number(), resetsAt: z.string().nullable() })),
});
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

interface UsagePorts {
  callRpc: BbPluginApi['sdk']['plugins']['callRpc'];
  getThread(input: { threadId: string }): Promise<{ providerId: string; environmentId: string | null }>;
  getEnvironment(input: { environmentId: string }): Promise<{ hostId: string }>;
  listProviders(): Promise<{ id: string; displayName: string }[]>;
  listPlugins(): Promise<{ plugins: { id: string; enabled: boolean }[] }>;
}

export function createUsageReader(ports: UsagePorts) {
  const read = (providerIds: string[], machineIds: string[] | null, refresh: boolean) => ports.callRpc({
    pluginId: 'bb--provider-usage', method: 'getUsage', outputSchema: sourceSnapshotSchema,
    input: { force: refresh, machineIds, providerIds, maxAgeMs: refresh ? 0 : 120_000 },
    signal: AbortSignal.timeout(60_000),
  });
  async function overview(refresh: boolean) {
    const inventory = await read([], null, false);
    const providerIds = [...new Set(inventory.machines.flatMap(machine => machine.providers.map(account => account.providerId)))];
    const snapshot = describeAccounts(providerIds.length ? await read(providerIds, null, refresh) : inventory);
    return { machines: snapshot.machines.map(machine => ({ ...machine, providers: foldDefaultProfile(machine.providers) })) };
  }
  async function header(threadId: string): Promise<Header> {
    const thread = await ports.getThread({ threadId });
    const providers = await ports.listProviders();
    const label = providers.find(provider => provider.id === thread.providerId)?.displayName ?? thread.providerId;
    const base = { providerId: thread.providerId, label, accountLabel: null, windows: [] };
    if (thread.providerId === 'claude-code') {
      const installed = await ports.listPlugins();
      if (installed.plugins.some(item => item.id === 'claude-profiles' && item.enabled)) {
        const profile = await ports.callRpc({
          pluginId: 'claude-profiles', method: 'accounts', input: { threadId }, outputSchema: profileThreadSchema,
          signal: AbortSignal.timeout(15_000),
        });
        if (profile.supported) {
          const usage = await ports.callRpc({
            pluginId: 'claude-profiles', method: 'usage', input: { threadId, profileId: profile.currentId, refresh: false },
            outputSchema: profileUsageSchema, signal: AbortSignal.timeout(30_000),
          });
          return { ...base, accountLabel: profile.profiles.find(value => value.id === profile.currentId)?.label ?? 'Default',
            windows: usage.windows.filter(window => window.id === 'five_hour' || window.id === 'seven_day').map(window => describeWindow({
              label: window.id === 'five_hour' ? '5h' : '7d', usedPercent: window.usedPercent, resetsAt: window.resetsAt, cost: null,
            })), message: usage.status !== 'ok' ? usage.message ?? 'Usage unavailable' : null };
        }
      }
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
  return { overview, header };
}

export default function plugin(bb: BbPluginApi) {
  const reader = createUsageReader({
    callRpc: args => bb.sdk.plugins.callRpc(args),
    getThread: args => bb.sdk.threads.get(args),
    getEnvironment: args => bb.sdk.environments.get(args),
    listProviders: () => bb.sdk.providers.list(),
    listPlugins: () => bb.sdk.plugins.list(),
  });
  bb.rpc.register(rpcContract, { overview: input => reader.overview(input.refresh), header: input => reader.header(input.threadId) });
  bb.cli.register({ name: 'agent-usage', summary: 'Read all provider account usage or a thread quota',
    async run(argv) {
      let value;
      if (argv.length === 0 || (argv.length === 1 && argv[0] === '--refresh')) value = await reader.overview(argv.length === 1);
      else if (argv.length === 2 && argv[0] === '--thread') value = await reader.header(argv[1]);
      else return { exitCode: 1, stderr: 'Usage: bb agent-usage [--refresh | --thread THREAD_ID]\n' };
      return { exitCode: 0, stdout: JSON.stringify(value, null, 2) + '\n' };
    },
  });
}
