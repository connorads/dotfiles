import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import type { OrganizationMode, RecentView } from './contracts.ts';
import plugin from './server.ts';

function harness(initialMode: OrganizationMode = 'project') {
  let mode: OrganizationMode = initialMode;
  const kv = new Map<string, unknown>();
  const published: { channel: string; payload: unknown }[] = [];
  const rpcHandlers: Record<string, (input: unknown) => Promise<RecentView>> = {};

  const bb = {
    storage: {
      kv: {
        get: async (key: string) => kv.get(key),
        set: async (key: string, value: unknown) => { kv.set(key, value); },
      },
    },
    sdk: {
      plugins: {
        callRpc: async ({ pluginId, method, input, outputSchema }: {
          pluginId: string;
          method: string;
          input?: unknown;
          outputSchema: { parse(value: unknown): unknown };
        }) => {
          assert.equal(pluginId, 'thread-list');
          if (method === 'listPreferences') {
            return outputSchema.parse({ preferences: { organizationMode: mode } });
          }
          if (method === 'setPreference') {
            const payload = input as { key: string; value: OrganizationMode };
            assert.equal(payload.key, 'organizationMode');
            mode = payload.value;
            return outputSchema.parse({ key: payload.key, value: payload.value });
          }
          throw new Error(`Unexpected method: ${method}`);
        },
      },
    },
    realtime: {
      publish: (channel: string, payload: unknown) => {
        published.push({ channel, payload });
      },
    },
    rpc: {
      register: (_contract: unknown, handlers: Record<string, (input: unknown) => Promise<RecentView>>) => {
        Object.assign(rpcHandlers, handlers);
      },
    },
  } as unknown as BbPluginApi;

  plugin(bb);

  return {
    view: () => rpcHandlers.view!({}),
    toggle: () => rpcHandlers.toggle!({}),
    setExternalMode: (next: OrganizationMode) => { mode = next; },
    currentMode: () => mode,
    published,
  };
}

test('view reads live organizationMode from thread-list', async () => {
  const h = harness('project');
  assert.deepEqual(await h.view(), { mode: 'project', restoreMode: 'project' });
  h.setExternalMode('chronological');
  assert.deepEqual(await h.view(), { mode: 'chronological', restoreMode: 'project' });
});

test('toggle switches project -> chronological -> project and publishes state', async () => {
  const h = harness('project');

  assert.deepEqual(await h.toggle(), { mode: 'chronological', restoreMode: 'project' });
  assert.equal(h.currentMode(), 'chronological');

  assert.deepEqual(await h.toggle(), { mode: 'project', restoreMode: 'project' });
  assert.equal(h.currentMode(), 'project');

  assert.deepEqual(h.published, [
    { channel: 'state', payload: { mode: 'chronological', restoreMode: 'project' } },
    { channel: 'state', payload: { mode: 'project', restoreMode: 'project' } },
  ]);
});

test('toggle remembers machine mode when switching to chronological and restores it', async () => {
  const h = harness('machine');

  assert.deepEqual(await h.toggle(), { mode: 'chronological', restoreMode: 'machine' });
  assert.deepEqual(await h.toggle(), { mode: 'machine', restoreMode: 'machine' });
});

test('toggle respects external mode changes made through the Organize menu', async () => {
  const h = harness('project');

  await h.toggle();
  h.setExternalMode('machine');
  assert.deepEqual(await h.toggle(), { mode: 'chronological', restoreMode: 'machine' });
  assert.deepEqual(await h.toggle(), { mode: 'machine', restoreMode: 'machine' });
});

test('concurrent toggles run sequentially without dropping the second press', async () => {
  const h = harness('project');
  const [first, second] = await Promise.all([h.toggle(), h.toggle()]);
  assert.deepEqual(first, { mode: 'chronological', restoreMode: 'project' });
  assert.deepEqual(second, { mode: 'project', restoreMode: 'project' });
  assert.equal(h.currentMode(), 'project');
});
