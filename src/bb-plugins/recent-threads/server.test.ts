import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import type { Lifecycles, OrganizationMode, RecentView } from './contracts.ts';
import plugin from './server.ts';

function harness(initialMode: OrganizationMode = 'project', initialLifecycles: Lifecycles = ['active']) {
  let mode: OrganizationMode = initialMode;
  let lifecycles: Lifecycles = initialLifecycles;
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
            return outputSchema.parse({ preferences: { organizationMode: mode, threadLifecycles: lifecycles } });
          }
          if (method === 'setPreference') {
            const payload = input as { key: string; value: unknown };
            if (payload.key === 'organizationMode') mode = payload.value as OrganizationMode;
            else if (payload.key === 'threadLifecycles') lifecycles = payload.value as Lifecycles;
            else throw new Error(`Unexpected key: ${payload.key}`);
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
    toggleArchived: () => rpcHandlers.toggleArchived!({}),
    setExternalMode: (next: OrganizationMode) => { mode = next; },
    setExternalLifecycles: (next: Lifecycles) => { lifecycles = next; },
    currentMode: () => mode,
    currentLifecycles: () => lifecycles,
    published,
  };
}

const active: Lifecycles = ['active'];

test('view reads live organizationMode and threadLifecycles from thread-list', async () => {
  const h = harness('project');
  assert.deepEqual(await h.view(), { mode: 'project', restoreMode: 'project', lifecycles: active });
  h.setExternalMode('chronological');
  h.setExternalLifecycles(['archived']);
  assert.deepEqual(await h.view(), { mode: 'chronological', restoreMode: 'project', lifecycles: ['archived'] });
});

test('toggle switches project -> chronological -> project and publishes state', async () => {
  const h = harness('project');

  assert.deepEqual(await h.toggle(), { mode: 'chronological', restoreMode: 'project', lifecycles: active });
  assert.equal(h.currentMode(), 'chronological');

  assert.deepEqual(await h.toggle(), { mode: 'project', restoreMode: 'project', lifecycles: active });
  assert.equal(h.currentMode(), 'project');

  assert.deepEqual(h.published, [
    { channel: 'state', payload: { mode: 'chronological', restoreMode: 'project', lifecycles: active } },
    { channel: 'state', payload: { mode: 'project', restoreMode: 'project', lifecycles: active } },
  ]);
});

test('toggle remembers machine mode when switching to chronological and restores it', async () => {
  const h = harness('machine');

  assert.deepEqual(await h.toggle(), { mode: 'chronological', restoreMode: 'machine', lifecycles: active });
  assert.deepEqual(await h.toggle(), { mode: 'machine', restoreMode: 'machine', lifecycles: active });
});

test('toggle respects external mode changes made through the Organize menu', async () => {
  const h = harness('project');

  await h.toggle();
  h.setExternalMode('machine');
  assert.deepEqual(await h.toggle(), { mode: 'chronological', restoreMode: 'machine', lifecycles: active });
  assert.deepEqual(await h.toggle(), { mode: 'machine', restoreMode: 'machine', lifecycles: active });
});

test('concurrent toggles run sequentially without dropping the second press', async () => {
  const h = harness('project');
  const [first, second] = await Promise.all([h.toggle(), h.toggle()]);
  assert.equal(first.mode, 'chronological');
  assert.equal(second.mode, 'project');
  assert.equal(h.currentMode(), 'project');
});

test('toggleArchived shows archived only, keeps the grouping, then restores active', async () => {
  const h = harness('project');

  assert.deepEqual(await h.toggleArchived(), { mode: 'project', restoreMode: 'project', lifecycles: ['archived'] });
  assert.deepEqual(h.currentLifecycles(), ['archived']);
  assert.equal(h.currentMode(), 'project');

  assert.deepEqual(await h.toggleArchived(), { mode: 'project', restoreMode: 'project', lifecycles: active });
  assert.deepEqual(h.currentLifecycles(), active);
  assert.deepEqual(h.published.map(entry => entry.channel), ['state', 'state']);
});

test('toggleArchived restores an Active + Archived filter set through the Filter menu', async () => {
  const h = harness('chronological', ['active', 'archived']);

  await h.toggleArchived();
  assert.deepEqual(h.currentLifecycles(), ['archived']);
  await h.toggleArchived();
  assert.deepEqual(h.currentLifecycles(), ['active', 'archived']);
});

test('toggleArchived from an externally set archived-only filter restores active', async () => {
  const h = harness('project', ['archived']);
  await h.toggleArchived();
  assert.deepEqual(h.currentLifecycles(), active);
});

test('recent and archived toggles combine to show recently archived threads', async () => {
  const h = harness('project');
  const [, both] = await Promise.all([h.toggle(), h.toggleArchived()]);
  assert.deepEqual(both, { mode: 'chronological', restoreMode: 'project', lifecycles: ['archived'] });
});
