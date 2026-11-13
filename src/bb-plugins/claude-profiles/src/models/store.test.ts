import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSchema } from './contract.ts';
import { createStore } from './store.ts';

const setup = { providerId: 'codex', model: 'model-a' };
function memory() {
  let data: unknown = null;
  let id = 0;
  const storage = { get: async () => data, set: async (value: unknown) => { data = value; } };
  return { storage, store: createStore(storage, () => String(++id), () => {}) };
}

test('concurrent saves persist both entries and deletion leaves shortcut slots stable', async () => {
  const { storage, store } = memory();
  await Promise.all([store.add({ name: 'One', ...setup }), store.add({ name: 'Two', ...setup, model: 'model-b' })]);
  const saved = await store.list();
  assert.deepEqual(saved.map(f => f.slot), [1, 2]);
  await store.remove(saved[0]!.id);
  assert.equal((await store.list())[0]?.slot, 2);
  const reopened = createStore(storage, () => '3', () => {});
  assert.deepEqual(await reopened.list(), await store.list());
});

test('missing ids cannot remove another favourite', async () => {
  const { store } = memory();
  await store.add({ name: 'One', ...setup });
  await store.add({ name: 'Two', ...setup, model: 'model-b' });
  await assert.rejects(store.remove('missing'), /Favourite no longer exists/);
  assert.equal((await store.list()).length, 2);
});

test('concurrent stars of the same model occupy one shortcut slot', async () => {
  const { store } = memory();
  await Promise.all([store.add({ name: '', ...setup }), store.add({ name: '', ...setup, reasoningLevel: 'high' })]);
  const list = await store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.slot, 1);
});

test('a favourite remembers effort and tier without moving, and null clears them', async () => {
  const { store } = memory();
  await store.add({ name: '', ...setup });
  await store.add({ name: '', ...setup, model: 'model-b', reasoningLevel: 'low' });
  const [, changed] = await store.remember('2', { reasoningLevel: 'xhigh', serviceTier: 'fast' });
  assert.deepEqual([changed?.id, changed?.slot, changed?.reasoningLevel, changed?.serviceTier], ['2', 2, 'xhigh', 'fast']);
  const kept = (await store.remember('2', { reasoningLevel: 'high' })).find(f => f.id === '2');
  assert.deepEqual([kept?.reasoningLevel, kept?.serviceTier], ['high', 'fast']);
  const cleared = (await store.remember('2', { reasoningLevel: null, serviceTier: null })).find(f => f.id === '2');
  assert.equal(cleared?.slot, 2);
  assert.equal('reasoningLevel' in (cleared ?? {}), false);
  assert.equal('serviceTier' in (cleared ?? {}), false);
  await assert.rejects(store.remember('missing', { reasoningLevel: 'low' }), /Favourite no longer exists/);
});

test('a list with the same provider and model twice is refused', async () => {
  const twice = [{ id: 'a', slot: 1, name: '', ...setup }, { id: 'b', slot: 2, name: '', ...setup, reasoningLevel: 'low' }];
  assert.equal(listSchema.safeParse(twice).success, false);
  const store = createStore({ get: async () => twice, set: async () => {} }, () => 'x', () => {});
  await assert.rejects(store.list(), /only once/);
});


test('standard and Daybreak favourites persist independently for the same model', async () => {
  const { storage, store } = memory();
  await store.add({ name: '', ...setup, daybreak: false });
  await store.add({ name: '', ...setup, daybreak: true });
  const reopened = createStore(storage, () => '3', () => {});
  assert.deepEqual((await reopened.list()).map(f => f.daybreak), [false, true]);
});
