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

test('a saved effort changes without moving the favourite, and null clears it', async () => {
  const { store } = memory();
  await store.add({ name: '', ...setup });
  await store.add({ name: '', ...setup, model: 'model-b', reasoningLevel: 'low' });
  const [, changed] = await store.setEffort('2', 'xhigh');
  assert.deepEqual([changed?.id, changed?.slot, changed?.reasoningLevel], ['2', 2, 'xhigh']);
  const cleared = (await store.setEffort('2', null)).find(f => f.id === '2');
  assert.equal(cleared?.slot, 2);
  assert.equal('reasoningLevel' in (cleared ?? {}), false);
  await assert.rejects(store.setEffort('missing', 'low'), /Favourite no longer exists/);
});

test('a list with the same provider and model twice is refused', async () => {
  const twice = [{ id: 'a', slot: 1, name: '', ...setup }, { id: 'b', slot: 2, name: '', ...setup, reasoningLevel: 'low' }];
  assert.equal(listSchema.safeParse(twice).success, false);
  const store = createStore({ get: async () => twice, set: async () => {} }, () => 'x', () => {});
  await assert.rejects(store.list(), /only once/);
});
