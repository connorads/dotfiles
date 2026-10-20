import type { AmpOverview } from './amp-reading.ts';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { usageContract, type LoginMethod } from './contract.ts';
import { createUsageReader, type UsagePorts } from './overview.ts';

type AccountPorts = Pick<UsagePorts, 'resetCredits' | 'claudeAccount' | 'claudeResource'> & {
  amp: (refresh: boolean) => Promise<AmpOverview>;
  login: (hostId: string, accountId: string, method?: LoginMethod) => Promise<{ terminalId: string }>;
};

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
    'usage.inspection': input => reader.inspection(input.refresh),
  });
  return reader;
}
