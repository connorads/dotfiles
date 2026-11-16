import type { AmpOverview } from './amp-reading.ts';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { inspectionSchema, usageContract, type LoginMethod } from './contract.ts';
import { createUsageReader, type UsagePorts } from './overview.ts';

type AccountPorts = Pick<UsagePorts, 'antigravityLabels' | 'resetCredits' | 'claudeResets' | 'claudeAccount' | 'claudeResource'> & {
  amp: (refresh: boolean) => Promise<AmpOverview>;
  login: (hostId: string, accountId: string, method?: LoginMethod) => Promise<{ terminalId: string }>;
};

const savedKey = 'usage.inspection';

export function registerUsage(bb: BbPluginApi, accounts: AccountPorts) {
  const reader = createUsageReader({
    ...accounts,
    callRpc: args => bb.sdk.plugins.callRpc(args),
    getThread: args => bb.sdk.threads.get(args),
    getEnvironment: args => bb.sdk.environments.get(args),
    listProviders: () => bb.sdk.providers.list(),
  });
  bb.rpc.register(usageContract, {
    'usage.login': input => accounts.login(input.hostId, input.accountId, input.method),
    'usage.amp': input => accounts.amp(input.refresh),
    'usage.header': input => reader.header(input.threadId),
    'usage.inspection': async input => {
      const value = await reader.inspection(input.refresh);
      await bb.storage.kv.set(savedKey, value).catch(error => bb.log.warn(`Could not save the usage reading: ${error instanceof Error ? error.message : String(error)}`));
      return value;
    },
    // A reading saved by an earlier plugin version may no longer parse; the overlay then waits for collection.
    'usage.saved': async () => inspectionSchema.safeParse(await bb.storage.kv.get(savedKey)).data ?? null,
  });
  return reader;
}
