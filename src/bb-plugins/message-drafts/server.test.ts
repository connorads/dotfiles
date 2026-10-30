import { afterEach, expect, test } from 'vitest';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from './server.ts';
import { resultSchema } from './contracts.ts';
const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });
function setup() { const host = createFakePluginHost({ pluginId: 'message-drafts' }); hosts.push(host); plugin(host.bb); return host.harness; }
test('saves per thread and survives plugin reload', async () => {
  const h = setup();
  expect(await h.behavior.callRpc('read', { threadId: 'thread-one' })).toEqual({ text: '', revision: 0 });
  await h.behavior.callRpc('write', { threadId: 'thread-one', text: 'Hello Alex', revision: 0 });
  const next = await h.lifecycle.reload(plugin);
  hosts.splice(0, 1, next);
  expect(await next.harness.behavior.callRpc('read', { threadId: 'thread-one' })).toEqual({ text: 'Hello Alex', revision: 1 });
  expect(await next.harness.behavior.callRpc('read', { threadId: 'thread-two' })).toEqual({ text: '', revision: 0 });
});
test('concurrent stale writers cannot overwrite the saved message', async () => {
  const h = setup();
  const raw = await Promise.all(['First edit', 'Second edit'].map(text => h.behavior.callRpc('write', { threadId: 'thread-one', text, revision: 0 })));
  const results = raw.map(value => resultSchema.parse(value));
  expect(results.filter(r => r.ok)).toHaveLength(1);
  expect(results.filter(r => !r.ok)).toHaveLength(1);
  expect(await h.behavior.callRpc('read', { threadId: 'thread-one' })).toEqual({ text: 'First edit', revision: 1 });
});
test('rejects oversized messages without changing storage', async () => {
  const h = setup();
  await expect(h.behavior.callRpc('write', { threadId: 'thread-one', text: 'x'.repeat(16001), revision: 0 })).rejects.toThrow();
  expect(await h.behavior.callRpc('read', { threadId: 'thread-one' })).toEqual({ text: '', revision: 0 });
});
