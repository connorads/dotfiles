import { expect, test } from 'vitest';
import { createUsageReader } from './server.ts';
import type { Snapshot } from './contracts.ts';

const snapshot: Snapshot = { machines: [{ id: 'host-one', displayName: 'Laptop', status: 'connected', error: null,
  providers: [{ id: 'provider-codex:["host-one","codex"]', providerId: 'codex', accountLabel: null, displayName: 'Codex',
    logoUrl: null, icon: null, strings: { iconTint: null }, signInHint: 'Sign in', expiredHint: 'Sign in again',
    usage: { status: 'ok', accountEmail: 'one@example.com', planLabel: 'Pro', windows: [{ label: 'Weekly limit', usedPercent: 6, resetsAt: null, cost: null }] } }] }] };

const unused = async () => { throw new Error('Unexpected port call'); };
const ports = {
  getThread: unused, getEnvironment: unused, listProviders: unused, listPlugins: unused,
};

test('overview requests every discovered provider through the existing collector and forwards forced refresh', async () => {
  const inputs: unknown[] = [];
  const reader = createUsageReader({ ...ports, callRpc: async input => {
    inputs.push(input);
    return input.outputSchema.parse(snapshot);
  } });
  expect(await reader.overview(true)).toEqual(snapshot);
  expect(inputs).toMatchObject([
    { pluginId: 'bb--provider-usage', input: { providerIds: [], force: false, machineIds: null } },
    { pluginId: 'bb--provider-usage', input: { providerIds: ['codex'], force: true, machineIds: null } },
  ]);
});

test('Claude header follows the selected profile rather than the native default login', async () => {
  const inputs: unknown[] = [];
  const reader = createUsageReader({ ...ports,
    getThread: async () => ({ providerId: 'claude-code', environmentId: 'env-one' }),
    listProviders: async () => [{ id: 'claude-code', displayName: 'Claude Code' }],
    listPlugins: async () => ({ plugins: [{ id: 'claude-profiles', enabled: true }] }),
    callRpc: async input => {
      inputs.push(input);
      return input.outputSchema.parse(input.method === 'thread'
        ? { supported: true, selection: { profile: { id: 'work', label: 'Work' } } }
        : { status: 'ok', message: null, windows: [{ id: 'seven_day', usedPercent: 81, resetsAt: null }] });
    },
  });
  expect(await reader.header('thread-one')).toMatchObject({ accountLabel: 'Work', windows: [{ label: '7d', usedPercent: 81 }] });
  expect(inputs).toMatchObject([{ method: 'thread' }, { method: 'usage', input: { profileId: 'work', refresh: false } }]);
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
  expect(await reader.header('thread-one')).toMatchObject({ label: 'Codex', windows: [{ label: 'Weekly limit', usedPercent: 6 }] });
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
