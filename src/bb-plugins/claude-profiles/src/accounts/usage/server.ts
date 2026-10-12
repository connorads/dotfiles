import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { usageContract } from './contract.ts';
import { createUsageReader, type UsagePorts } from './overview.ts';

type AccountPorts = Pick<UsagePorts, 'resetCredits' | 'claudeAccount' | 'claudeResource'>;

export function registerUsage(bb: BbPluginApi, accounts: AccountPorts) {
  const reader = createUsageReader({
    ...accounts,
    callRpc: args => bb.sdk.plugins.callRpc(args),
    getThread: args => bb.sdk.threads.get(args),
    getEnvironment: args => bb.sdk.environments.get(args),
    listProviders: () => bb.sdk.providers.list(),
  });
  bb.rpc.register(usageContract, {
    'usage.overview': input => reader.overview(input.refresh),
    'usage.header': input => reader.header(input.threadId),
    'usage.inspection': input => reader.inspection(input.refresh),
  });
  return reader;
}
