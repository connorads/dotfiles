import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin, { readOwner } from './server';

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });
async function fixture() {
  const home = await mkdtemp(join(await realpath(tmpdir()), 'context-owner-'));
  const directory = join(home, '.config', 'bb');
  await mkdir(directory, { recursive: true });
  return { home, directory, path: join(directory, 'plugin-config.json') };
}
test('reads only the exact owner and preserves its bytes without writing', async () => {
  const f = await fixture();
  const text = '{"synthetic-plugin":{"enabled":true}}\n';
  await writeFile(f.path, text);
  expect(await readOwner(f.home, 'host-synthetic')).toEqual({ kind: 'available', hostId: 'host-synthetic', text });
  expect(await readFile(f.path, 'utf8')).toBe(text);
});
test('refuses a symlink file and a symlink parent before reading content', async () => {
  const f = await fixture();
  const other = await fixture();
  await writeFile(other.path, '{}');
  await symlink(other.path, f.path);
  expect(await readOwner(f.home, 'host-synthetic')).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('symlink') });
  const alternate = await mkdtemp(join(await realpath(tmpdir()), 'context-link-'));
  await symlink(join(other.home, '.config'), join(alternate, '.config'));
  expect(await readOwner(alternate, 'host-synthetic')).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('symlink') });
});
test('missing and oversized owners are unavailable', async () => {
  const f = await fixture();
  expect((await readOwner(f.home, 'host-synthetic')).kind).toBe('unavailable');
  await writeFile(f.path, 'x'.repeat(256 * 1024 + 1));
  expect(await readOwner(f.home, 'host-synthetic')).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('256 KiB') });
});
test('remote workspace refuses local owner reading and rejects caller paths', async () => {
  const host = createFakePluginHost({ pluginId: 'context-inspector', sdk: {
    system: { config: () => ({ primaryHostId: 'host-server' }) },
    threads: { get: () => ({ environmentId: 'environment-synthetic' }) },
    environments: { get: () => ({ hostId: 'host-remote' }) },
  } });
  hosts.push(host); plugin(host.bb);
  expect(await host.harness.behavior.callRpc('owner', { threadId: 'thread-synthetic' })).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('same server host') });
  await expect(host.harness.behavior.callRpc('owner', { threadId: 'thread-synthetic', path: '/synthetic' })).rejects.toThrow();
  expect(host.harness.inspection.registrations.agentTools).toHaveLength(0);
  expect(host.harness.inspection.registrations.instructionProvider).toBeNull();
  expect(host.harness.inspection.registrations.agentConfigurationProvider).toBeNull();
});
