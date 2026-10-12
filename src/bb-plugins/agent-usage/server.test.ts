import { expect, test } from 'vitest';
import { createUsageReader } from './server.ts';
import type { SourceSnapshot } from './contracts.ts';

const snapshot: SourceSnapshot = { machines: [{ id: 'host-one', displayName: 'Laptop', status: 'connected', error: null,
  providers: [{ id: 'provider-codex:["host-one","codex"]', providerId: 'codex', accountLabel: null, displayName: 'Codex',
    logoUrl: null, icon: null, strings: { iconTint: null }, signInHint: 'Sign in', expiredHint: 'Sign in again',
    usage: { status: 'ok', accountEmail: 'one@example.com', planLabel: 'Pro', windows: [{ label: 'Weekly limit', usedPercent: 6, resetsAt: null, cost: null }] } }] }] };

const unused = async () => { throw new Error('Unexpected port call'); };
const ports = {
  getThread: unused, getEnvironment: unused, listProviders: unused, listPlugins: unused,
  resetCredits: unused,
};

test('overview requests every discovered provider through the existing collector and forwards forced refresh', async () => {
  const inputs: unknown[] = [];
  const reader = createUsageReader({ ...ports, callRpc: async input => {
    inputs.push(input);
    return input.outputSchema.parse(snapshot);
  } });
  const overview = await reader.overview(true);
  expect(overview.machines[0]?.providers[0]?.usage).toMatchObject({ windows: [{ label: 'Weekly', period: 'week', usedPercent: 6 }] });
  expect(inputs).toMatchObject([
    { pluginId: 'bb--provider-usage', input: { providerIds: [], force: false, machineIds: null } },
    { pluginId: 'bb--provider-usage', input: { providerIds: ['codex'], force: true, machineIds: null } },
  ]);
});

test('inspection keeps provider observation times and isolates reset-credit failures by machine', async () => {
  const source = { ...snapshot, machines: snapshot.machines.map(machine => ({ ...machine, providers: machine.providers.map(account => ({ ...account,
    usage: account.usage?.status === 'ok' ? { ...account.usage, observedAt: 999 } : account.usage })) })) };
  const reader = createUsageReader({ ...ports,
    resetCredits: async () => { throw new Error('Host disconnected'); },
    callRpc: async input => input.outputSchema.parse(input.method === 'getUsage' ? source : { observedAt: 123, usage: { status: 'ok' } }),
  });
  const value = await reader.inspection(false);
  expect(value.snapshot).toEqual(await reader.overview(false));
  expect(value.readings).toEqual([{ accountId: snapshot.machines[0]!.providers[0]!.id, observedAt: 123 }]);
  expect(value.resetCredits).toEqual([{ hostId: 'host-one', reading: { status: 'unavailable', message: 'Reset credits could not be read from this machine.' } }]);
  expect(value.snapshot.machines[0]?.providers[0]?.usage).not.toHaveProperty('observedAt');
});

test('inspection requests reset credits only on connected Codex machines and passes refresh through', async () => {
  const calls: unknown[] = [];
  const reader = createUsageReader({ ...ports,
    resetCredits: async (hostId, refresh) => { calls.push([hostId, refresh]); return { status: 'unavailable', message: 'No cache' }; },
    callRpc: async input => input.outputSchema.parse(input.method === 'getUsage' ? { machines: [snapshot.machines[0],
      { ...snapshot.machines[0], id: 'offline', status: 'disconnected' },
      { ...snapshot.machines[0], id: 'empty', providers: [] }] } : { observedAt: null, usage: { status: 'ok' } }),
  });
  expect((await reader.inspection(true)).resetCredits).toHaveLength(2);
  expect(calls).toEqual([['host-one', true]]);
});

test('Claude header follows the selected profile rather than the native default login', async () => {
  const inputs: unknown[] = [];
  const reader = createUsageReader({ ...ports,
    getThread: async () => ({ providerId: 'claude-code', environmentId: 'env-one' }),
    listProviders: async () => [{ id: 'claude-code', displayName: 'Claude Code' }],
    listPlugins: async () => ({ plugins: [{ id: 'claude-profiles', enabled: true }] }),
    callRpc: async input => {
      inputs.push(input);
      return input.outputSchema.parse(input.method === 'accounts'
        ? { supported: true, currentId: 'work', profiles: [{ id: 'default', label: 'Default' }, { id: 'work', label: 'Work' }] }
        : { status: 'ok', message: null, windows: [{ id: 'seven_day', usedPercent: 81, resetsAt: null }] });
    },
  });
  expect(await reader.header('thread-one')).toMatchObject({ accountLabel: 'Work', windows: [{ label: 'Weekly', period: 'week', usedPercent: 81 }] });
  expect(inputs).toMatchObject([{ method: 'accounts' }, { method: 'usage', input: { profileId: 'work', refresh: false } }]);
});

test('Codex header uses the thread host and displays only the windows reported', async () => {
  const reader = createUsageReader({ ...ports,
    getThread: async () => ({ providerId: 'codex', environmentId: 'env-one' }),
    getEnvironment: async () => ({ hostId: 'host-one' }),
    listProviders: async () => [{ id: 'codex', displayName: 'Codex' }],
    callRpc: async input => {
      expect(input.input).toMatchObject({ machineIds: ['host-one'], providerIds: ['codex'] });
      return input.outputSchema.parse(snapshot);
    },
  });
  expect(await reader.header('thread-one')).toMatchObject({ label: 'Codex', windows: [{ label: 'Weekly', period: 'week', usedPercent: 6 }] });
});

 test('missing usage remains unavailable instead of reporting zero', async () => {
  const reader = createUsageReader({ ...ports,
    getThread: async () => ({ providerId: 'codex', environmentId: 'env-one' }),
    getEnvironment: async () => ({ hostId: 'host-one' }),
    listProviders: async () => [],
    callRpc: async input => input.outputSchema.parse({ machines: [] }),
  });
  expect(await reader.header('thread-one')).toMatchObject({ windows: [], message: 'Usage unavailable' });
});

const claude = (id: string, accountLabel: string | null, usage: unknown) => ({ id, providerId: 'claude-code', accountLabel,
  displayName: 'Claude Code', logoUrl: null, icon: null, strings: { iconTint: null }, signInHint: 'Sign in', expiredHint: 'Sign in again', usage });
const window = (label: string, usedPercent: number, cost: { usedUsdCents: number; limitUsdCents: number } | null = null) =>
  ({ label, usedPercent, resetsAt: '2026-10-19T00:00:00Z', cost });

test('the default Claude profile folds into the native login it shares, keeping both sources\' windows', async () => {
  const native = claude('provider-claude-code:["host-one","claude-code"]', null, { status: 'ok', accountEmail: 'me@example.com',
    planLabel: 'Max (20x)', windows: [window('Five-hour limit', 9), window('Weekly limit', 4), window('Weekly · Fable', 0)] });
  const profile = (name: string, windows: unknown[]) => claude(`claude-profiles:["host-one","~/.claude-profiles","${name}"]`, null,
    { status: 'ok', accountEmail: null, planLabel: null, windows });
  const source = { machines: [{ ...snapshot.machines[0], providers: [native,
    profile('default', [window('Five-hour limit', 9), window('Weekly limit', 4), window('Credits', 0.03, { usedUsdCents: 6, limitUsdCents: 25000 })]),
    profile('work', [window('Weekly limit', 30)])] }] };
  const reader = createUsageReader({ ...ports, callRpc: async input => input.outputSchema.parse(source) });
  const accounts = (await reader.overview(false)).machines[0]?.providers ?? [];
  expect(accounts.map(account => account.accountLabel)).toEqual(['Default', 'work']);
  expect(accounts[0]?.usage).toMatchObject({ accountEmail: 'me@example.com', planLabel: 'Max (20x)' });
  expect(accounts[0]?.usage?.status === 'ok' && accounts[0].usage.windows.map(w => [w.label, w.period]))
    .toEqual([['5-hour', 'five-hour'], ['Weekly', 'week'], ['Weekly · Fable', 'week'], ['Credits', null]]);
});

test('an unreadable native login yields to the default profile reading', async () => {
  const native = claude('provider-claude-code:["host-one","claude-code"]', null, { status: 'expired' });
  const profile = claude('claude-profiles:["host-one","~/.claude-profiles","default"]', null,
    { status: 'ok', accountEmail: null, planLabel: null, windows: [window('Weekly limit', 4)] });
  const reader = createUsageReader({ ...ports, callRpc: async input => input.outputSchema.parse({ machines: [{ ...snapshot.machines[0], providers: [native, profile] }] }) });
  const accounts = (await reader.overview(false)).machines[0]?.providers ?? [];
  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({ accountLabel: 'Default', usage: { status: 'ok', windows: [{ label: 'Weekly' }] } });
});
