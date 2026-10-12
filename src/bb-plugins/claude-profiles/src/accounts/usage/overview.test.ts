import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUsageReader, type UsagePorts } from './overview.ts';
import type { SourceSnapshot } from './contract.ts';

const snapshot: SourceSnapshot = { machines: [{ id: 'host-one', displayName: 'Laptop', status: 'connected', error: null,
  providers: [{ id: 'provider-codex:["host-one","codex"]', providerId: 'codex', accountLabel: null, displayName: 'Codex',
    logoUrl: null, icon: null, strings: { iconTint: null }, signInHint: 'Sign in', expiredHint: 'Sign in again',
    usage: { status: 'ok', accountEmail: 'one@example.com', planLabel: 'Pro', windows: [{ label: 'Weekly limit', usedPercent: 6, resetsAt: null, cost: null }] } }] }] };

const unused = async () => { throw new Error('Unexpected port call'); };
const ports: Omit<UsagePorts, 'callRpc'> = {
  getThread: unused, getEnvironment: unused, listProviders: unused, resetCredits: unused, claudeAccount: unused, claudeResource: unused,
};
type Call = Parameters<UsagePorts['callRpc']>[0];
// Each test answers with its own data; the parse keeps the schema boundary the real RPC applies.
const answer = (respond: (input: Call) => unknown): UsagePorts['callRpc'] =>
  (async (input: Call) => input.outputSchema.parse(respond(input))) as UsagePorts['callRpc'];

test('overview requests every discovered provider through the existing collector and forwards forced refresh', async () => {
  const inputs: Call[] = [];
  const reader = createUsageReader({ ...ports, callRpc: answer(input => { inputs.push(input); return snapshot; }) });
  const overview = await reader.overview(true);
  assert.partialDeepStrictEqual(overview.machines[0]?.providers[0]?.usage,
    { windows: [{ label: 'Weekly', period: 'week', usedPercent: 6 }] });
  assert.deepEqual(inputs.map(input => [input.pluginId, input.input]), [
    ['bb--provider-usage', { force: false, machineIds: null, providerIds: [], maxAgeMs: 120_000 }],
    ['bb--provider-usage', { force: true, machineIds: null, providerIds: ['codex'], maxAgeMs: 0 }],
  ]);
});

test('inspection keeps provider observation times and isolates reset-credit failures by machine', async () => {
  const source = { ...snapshot, machines: snapshot.machines.map(machine => ({ ...machine, providers: machine.providers.map(account => ({ ...account,
    usage: account.usage?.status === 'ok' ? { ...account.usage, observedAt: 999 } : account.usage })) })) };
  const reader = createUsageReader({ ...ports,
    resetCredits: async () => { throw new Error('Host disconnected'); },
    callRpc: answer(input => input.method === 'getUsage' ? source : { observedAt: 123, usage: snapshot.machines[0]!.providers[0]!.usage }),
  });
  const value = await reader.inspection(false);
  assert.deepEqual(value.snapshot, await reader.overview(false));
  assert.deepEqual(value.readings, [{ accountId: snapshot.machines[0]!.providers[0]!.id, observedAt: 123 }]);
  assert.deepEqual(value.resetCredits, [{ hostId: 'host-one', reading: { status: 'unavailable', message: 'Reset credits could not be read from this machine.' } }]);
  assert.ok(!('observedAt' in (value.snapshot.machines[0]?.providers[0]?.usage ?? {})));
});

test('inspection requests reset credits only on connected Codex machines and passes refresh through', async () => {
  const calls: unknown[] = [];
  const reader = createUsageReader({ ...ports,
    resetCredits: async (hostId, refresh) => { calls.push([hostId, refresh]); return { status: 'unavailable', message: 'No cache' }; },
    callRpc: answer(input => input.method === 'getUsage' ? { machines: [snapshot.machines[0],
      { ...snapshot.machines[0], id: 'offline', status: 'disconnected' },
      { ...snapshot.machines[0], id: 'empty', providers: [] }] } : { observedAt: null, usage: snapshot.machines[0]!.providers[0]!.usage }),
  });
  assert.equal((await reader.inspection(true)).resetCredits.length, 2);
  assert.deepEqual(calls, [['host-one', true]]);
});

test('inspection pairs a refreshed source timestamp with that source\'s figures', async () => {
  const usage = snapshot.machines[0]!.providers[0]!.usage;
  if (usage?.status !== 'ok') throw new Error('Invalid fixture');
  const reader = createUsageReader({ ...ports, resetCredits: async () => ({ status: 'unavailable', message: 'No cache' }),
    callRpc: answer(input => input.method === 'getUsage' ? snapshot : { observedAt: 123,
      usage: { ...usage, windows: [{ ...usage.windows[0], usedPercent: 80 }] } }),
  });
  const value = await reader.inspection(false);
  assert.partialDeepStrictEqual(value.snapshot.machines[0]?.providers[0]?.usage, { windows: [{ usedPercent: 80 }] });
  assert.equal(value.readings[0]?.observedAt, 123);
});

const claude = (id: string, accountLabel: string | null, usage: unknown) => ({ id, providerId: 'claude-code', accountLabel,
  displayName: 'Claude Code', logoUrl: null, icon: null, strings: { iconTint: null }, signInHint: 'Sign in', expiredHint: 'Sign in again', usage });
const window = (label: string, usedPercent: number, cost: { usedUsdCents: number; limitUsdCents: number } | null = null) =>
  ({ label, usedPercent, resetsAt: '2026-10-19T00:00:00Z', cost });

test('inspection reads this plugin\'s own profile resources in process, not over RPC', async () => {
  const resource = '["host-one","~/.claude-profiles","work"]';
  const resourceReads: unknown[] = [];
  const pluginCalls: string[] = [];
  const reader = createUsageReader({ ...ports,
    claudeResource: async (resourceId, refresh) => {
      resourceReads.push([resourceId, refresh]);
      return { accountKey: null, observedAt: 456, usage: { status: 'ok', plan: null, accountEmail: null, planLabel: null,
        windows: [{ id: 'seven_day', label: 'Seven days', kind: 'weekly', usedPercent: 40, resetsAt: null, model: null, cost: null }] } };
    },
    callRpc: answer(input => {
      pluginCalls.push(`${input.pluginId} ${input.method}`);
      return { machines: [{ ...snapshot.machines[0], providers: [claude(`claude-profiles:${resource}`, null,
        { status: 'ok', accountEmail: null, planLabel: null, windows: [window('Seven days', 30)] })] }] };
    }),
  });
  const value = await reader.inspection(false);
  assert.deepEqual(resourceReads, [[resource, false]]);
  assert.ok(pluginCalls.every(call => call.startsWith('bb--provider-usage ')));
  assert.equal(value.readings[0]?.observedAt, 456);
  assert.partialDeepStrictEqual(value.snapshot.machines[0]?.providers[0], { accountLabel: 'work',
    usage: { windows: [{ label: 'Weekly', period: 'week', usedPercent: 40 }] } });
});

test('Claude header follows the thread\'s bound profile through the accounts module', async () => {
  const pluginCalls: unknown[] = [];
  const reader = createUsageReader({ ...ports,
    getThread: async () => ({ providerId: 'claude-code', environmentId: 'env-one' }),
    listProviders: async () => [{ id: 'claude-code', displayName: 'Claude Code' }],
    claudeAccount: async threadId => threadId === 'thread-one' ? { label: 'Work', usage: { status: 'ok', message: null, observedAt: 1,
      windows: [{ id: 'seven_day', label: 'Seven days', usedPercent: 81, resetsAt: null, cost: null },
        { id: 'seven_day_opus', label: 'seven day opus', usedPercent: 5, resetsAt: null, cost: null }] } } : null,
    callRpc: answer(input => { pluginCalls.push(input); return {}; }),
  });
  assert.deepEqual(await reader.header('thread-one'), { providerId: 'claude-code', label: 'Claude Code', accountLabel: 'Work',
    windows: [{ label: 'Weekly', period: 'week', usedPercent: 81, resetsAt: null, cost: null }], message: null });
  assert.deepEqual(pluginCalls, []);
});

test('a Claude header reports the profile\'s quota failure', async () => {
  const reader = createUsageReader({ ...ports,
    getThread: async () => ({ providerId: 'claude-code', environmentId: 'env-one' }),
    listProviders: async () => [],
    claudeAccount: async () => ({ label: 'Default', usage: { status: 'unauthenticated', windows: [], observedAt: null, message: 'Log in.' } }),
    callRpc: answer(() => { throw new Error('Unexpected RPC'); }),
  });
  assert.partialDeepStrictEqual(await reader.header('thread-one'), { accountLabel: 'Default', windows: [], message: 'Log in.' });
});

test('Codex header uses the thread host and displays only the windows reported', async () => {
  const reader = createUsageReader({ ...ports,
    getThread: async () => ({ providerId: 'codex', environmentId: 'env-one' }),
    getEnvironment: async () => ({ hostId: 'host-one' }),
    listProviders: async () => [{ id: 'codex', displayName: 'Codex' }],
    callRpc: answer(input => {
      assert.partialDeepStrictEqual(input.input, { machineIds: ['host-one'], providerIds: ['codex'] });
      return snapshot;
    }),
  });
  assert.partialDeepStrictEqual(await reader.header('thread-one'), { label: 'Codex', windows: [{ label: 'Weekly', period: 'week', usedPercent: 6 }] });
});

test('missing usage remains unavailable instead of reporting zero', async () => {
  const reader = createUsageReader({ ...ports,
    getThread: async () => ({ providerId: 'codex', environmentId: 'env-one' }),
    getEnvironment: async () => ({ hostId: 'host-one' }),
    listProviders: async () => [],
    callRpc: answer(() => ({ machines: [] })),
  });
  assert.deepEqual(await reader.header('thread-one'), { providerId: 'codex', label: 'codex', accountLabel: null, windows: [], message: 'Usage unavailable' });
});

test('the default Claude profile folds into the native login it shares, keeping both sources\' windows', async () => {
  const native = claude('provider-claude-code:["host-one","claude-code"]', null, { status: 'ok', accountEmail: 'me@example.com',
    planLabel: 'Max (20x)', windows: [window('Five-hour limit', 9), window('Weekly limit', 4), window('Weekly · Fable', 0)] });
  const profile = (name: string, windows: unknown[]) => claude(`claude-profiles:["host-one","~/.claude-profiles","${name}"]`, null,
    { status: 'ok', accountEmail: null, planLabel: null, windows });
  const source = { machines: [{ ...snapshot.machines[0], providers: [native,
    profile('default', [window('Five-hour limit', 9), window('Weekly limit', 4), window('Credits', 0.03, { usedUsdCents: 6, limitUsdCents: 25000 })]),
    profile('work', [window('Weekly limit', 30)])] }] };
  const reader = createUsageReader({ ...ports, callRpc: answer(() => source) });
  const accounts = (await reader.overview(false)).machines[0]?.providers ?? [];
  assert.deepEqual(accounts.map(account => account.accountLabel), ['Default', 'work']);
  assert.partialDeepStrictEqual(accounts[0]?.usage, { accountEmail: 'me@example.com', planLabel: 'Max (20x)' });
  assert.deepEqual(accounts[0]?.usage?.status === 'ok' && accounts[0].usage.windows.map(w => [w.label, w.period]),
    [['5-hour', 'five-hour'], ['Weekly', 'week'], ['Weekly · Fable', 'week'], ['Credits', null]]);
});

test('an unreadable native login yields to the default profile reading', async () => {
  const native = claude('provider-claude-code:["host-one","claude-code"]', null, { status: 'expired' });
  const profile = claude('claude-profiles:["host-one","~/.claude-profiles","default"]', null,
    { status: 'ok', accountEmail: null, planLabel: null, windows: [window('Weekly limit', 4)] });
  const reader = createUsageReader({ ...ports, callRpc: answer(() => ({ machines: [{ ...snapshot.machines[0], providers: [native, profile] }] })) });
  const accounts = (await reader.overview(false)).machines[0]?.providers ?? [];
  assert.equal(accounts.length, 1);
  assert.partialDeepStrictEqual(accounts[0], { accountLabel: 'Default', usage: { status: 'ok', windows: [{ label: 'Weekly' }] } });
});
