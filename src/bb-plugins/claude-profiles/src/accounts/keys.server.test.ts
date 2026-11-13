import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../../server.ts';

function setup() {
  let profiles = [{ id: 'default', label: 'Default', configDir: null }, { id: 'summit', label: 'Summit', configDir: '/p/summit' },
    { id: 'trove', label: 'Trove', configDir: '/p/trove' }];
  const { bb, harness } = createFakePluginHost({
    sdk: { hosts: { list: async () => [{ id: 'h1', status: 'connected' }] } } as never,
    experimental_callHostRpc: call => {
      if (call.method === 'profiles') return profiles;
      throw new Error(`Unexpected host call ${call.method}`);
    },
  });
  plugin(bb);
  return { bb, harness, setProfiles: (next: typeof profiles) => { profiles = next; } };
}
type Accounts = { profiles: { id: string; key: string | null }[] };
const keysOf = (value: unknown) => Object.fromEntries((value as Accounts).profiles.map(p => [p.id, p.key]));

test('accounts carry stable letters that survive a new account', async () => {
  const { harness, setProfiles } = setup();
  assert.deepEqual(keysOf(await harness.behavior.callRpc('accounts', { threadId: null })), { default: 'D', summit: 'S', trove: 'T' });
  setProfiles([{ id: 'studio', label: 'Studio', configDir: '/p/studio' }, { id: 'default', label: 'Default', configDir: null },
    { id: 'summit', label: 'Summit', configDir: '/p/summit' }, { id: 'trove', label: 'Trove', configDir: '/p/trove' }]);
  assert.deepEqual(keysOf(await harness.behavior.callRpc('accounts', { threadId: null })), { studio: 'U', default: 'D', summit: 'S', trove: 'T' });
});

test('sidebar badges use the account letter', async () => {
  const { bb, harness } = setup();
  await harness.behavior.callRpc('accounts', { threadId: null });
  await bb.storage.kv.set('thread:t1', { hostId: 'h1', profile: { id: 'trove', label: 'Trove', configDir: '/p/trove' } });
  assert.deepEqual(await harness.behavior.callRpc('threadAccounts', {}), [{ threadId: 't1', profileId: 'trove', label: 'Trove', key: 'T' }]);
});
