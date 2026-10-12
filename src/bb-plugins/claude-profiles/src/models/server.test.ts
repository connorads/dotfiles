import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../../server.ts';

const legacy = [
  { id: 'deep', slot: 1, name: 'Deep', providerId: 'codex', model: 'gpt-a', reasoningLevel: 'xhigh', serviceTier: 'fast' },
  { id: 'quick', slot: 4, name: '', providerId: 'claude-code', model: 'opus' },
];

function setup(source: unknown[] | null) {
  const { bb, harness } = createFakePluginHost({ sdk: { plugins: {
    list: async () => ({ plugins: source ? [{ id: 'model-favourites', enabled: true }] : [] }),
    callRpc: async (args: { pluginId: string; method: string }) => {
      if (!source || args.pluginId !== 'model-favourites' || args.method !== 'list') throw new Error('Plugin not found');
      return source;
    },
  } } as never });
  plugin(bb);
  const migrate = async () => {
    const result = await harness.behavior.runCli(['migrate-favourites']);
    return { ...result, report: result.exitCode === 0 ? JSON.parse(result.stdout) : null };
  };
  const list = () => harness.behavior.callRpc('favourites.list', {});
  return { bb, harness, migrate, list };
}

test('migration imports id, slot, name, effort and tier', async () => {
  const { migrate, list } = setup(legacy);
  const { exitCode, report } = await migrate();
  assert.equal(exitCode, 0);
  assert.deepEqual(report, { imported: 2, skipped: [] });
  assert.deepEqual(await list(), legacy);
});

test('a second migration imports nothing and leaves the list the same', async () => {
  const { migrate, list } = setup(legacy);
  await migrate();
  const before = await list();
  const { report } = await migrate();
  assert.deepEqual(report, { imported: 0, skipped: [
    { id: 'deep', reason: 'already imported' }, { id: 'quick', reason: 'already imported' }] });
  assert.deepEqual(await list(), before);
});

test('migration without Model Favourites exits 1 and writes nothing', async () => {
  const { bb, migrate, list } = setup(null);
  const result = await migrate();
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, 'Enable Model Favourites to migrate. Nothing changed.\n');
  assert.deepEqual(await list(), []);
  assert.equal(await bb.storage.kv.get('favourites'), undefined);
});

test('a legacy duplicate keeps the lowest slot and the other is skipped with its reason', async () => {
  const { migrate, list } = setup([{ ...legacy[0], id: 'later', slot: 6 }, ...legacy]);
  const { report } = await migrate();
  assert.deepEqual(report, { imported: 2, skipped: [{ id: 'later', reason: 'model already a favourite' }] });
  assert.deepEqual((await list() as { id: string }[]).map(f => f.id), ['deep', 'quick']);
});

test('a legacy favourite whose slot is taken moves to the lowest free slot', async () => {
  const { harness, migrate, list } = setup(legacy);
  await harness.behavior.callRpc('favourites.add', { name: '', providerId: 'pi', model: 'local' });
  const { report } = await migrate();
  assert.deepEqual(report, { imported: 2, skipped: [] });
  assert.deepEqual((await list() as { model: string; slot: number }[]).map(f => [f.model, f.slot]),
    [['local', 1], ['gpt-a', 2], ['opus', 4]]);
});
