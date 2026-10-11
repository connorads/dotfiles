import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { rpcContract, snapshotSchema, type Header, type Account } from './contracts.ts';

const profileThreadSchema = z.object({
  supported: z.boolean(), selection: z.object({ profile: z.object({ id: z.string(), label: z.string() }) }).nullable(),
});
const profileUsageSchema = z.object({
  status: z.enum(['ok', 'unavailable', 'unauthenticated', 'error']), message: z.string().nullable(),
  windows: z.array(z.object({ id: z.string(), usedPercent: z.number(), resetsAt: z.string().nullable() })),
});
const profileLocatorSchema = z.tuple([z.string(), z.string(), z.string()]);
const nativeLocatorSchema = z.tuple([z.string(), z.string()]);

function resourceLocator(account: Account): unknown {
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
    pluginId: 'bb--provider-usage', method: 'getUsage', outputSchema: snapshotSchema,
    input: { force: refresh, machineIds, providerIds, maxAgeMs: refresh ? 0 : 120_000 },
    signal: AbortSignal.timeout(60_000),
  });
  async function overview(refresh: boolean) {
    const inventory = await read([], null, false);
    const providerIds = [...new Set(inventory.machines.flatMap(machine => machine.providers.map(account => account.providerId)))];
    const snapshot = providerIds.length ? await read(providerIds, null, refresh) : inventory;
    for (const machine of snapshot.machines) {
      for (const account of machine.providers) {
        if (!account.id.startsWith('claude-profiles:')) continue;
        const locator = profileLocatorSchema.safeParse(resourceLocator(account));
        if (locator.success) account.accountLabel = locator.data[2] === 'default' ? 'Claude · Default' : `Claude · ${locator.data[2]}`;
      }
    }
    return snapshot;
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
          pluginId: 'claude-profiles', method: 'thread', input: { threadId }, outputSchema: profileThreadSchema,
          signal: AbortSignal.timeout(15_000),
        });
        if (profile.supported) {
          const usage = await ports.callRpc({
            pluginId: 'claude-profiles', method: 'usage', input: { threadId, profileId: profile.selection?.profile.id ?? 'default', refresh: false },
            outputSchema: profileUsageSchema, signal: AbortSignal.timeout(30_000),
          });
          return { ...base, accountLabel: profile.selection?.profile.label ?? 'Default',
            windows: usage.windows.filter(window => window.id === 'five_hour' || window.id === 'seven_day').map(window => ({
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
      windows: account?.usage?.status === 'ok' ? account.usage.windows : [],
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
