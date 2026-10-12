import { expect, test } from 'vitest';
import { capture, matches, nextFavourite, availability } from './favourites.ts';
import { createStore } from './store.ts';

const selection = { providerId: 'codex', model: 'model-a', reasoningLevel: 'high' as const, serviceTier: 'fast', permissionMode: 'full' as const };
const favourite = { id: 'a', slot: 1, name: 'Deep', ...capture(selection) };

test('favourites capture only provider and model', () => {
  expect(capture({ ...selection, projectId: 'project' })).toEqual({ providerId: 'codex', model: 'model-a' });
});

test('favourites match the model independently of effort and tier', () => {
  expect(matches(favourite, selection)).toBe(true);
  expect(matches(favourite, { ...selection, reasoningLevel: 'low', serviceTier: 'default' })).toBe(true);
});

test('cycling wraps and skips unavailable entries while keeping saved order', () => {
  const other = { ...favourite, id: 'b', slot: 3, model: 'model-b' };
  const last = { ...favourite, id: 'c', slot: 5, model: 'model-c' };
  const list = [favourite, other, last];
  expect(nextFavourite(list, selection, 1, f => f.id === 'b' ? 'Missing model' : null)?.id).toBe('c');
  expect(nextFavourite(list, selection, -1, () => null)?.id).toBe('c');
  expect(nextFavourite(list, { ...selection, model: 'custom' }, 1, () => null)?.id).toBe('a');
  expect(nextFavourite(list, selection, 1, () => 'Offline')).toBe(null);
});

test('availability distinguishes catalogue failure from a missing model', () => {
  const catalog = { available: true, error: null, models: [{ model: 'model-a' }] };
  expect(availability(favourite, catalog)).toBe(null);
  expect(availability({ ...favourite, reasoningLevel: 'ultra', serviceTier: 'fast' }, catalog)).toBe(null);
  expect(availability(favourite, { ...catalog, error: 'Sign in required', models: [] })).toBe('Sign in required');
  expect(availability(favourite, { ...catalog, models: [] })).toContain('Model unavailable');
  expect(availability(favourite, { ...catalog, available: false })).toContain('Provider unavailable');
});

test('concurrent saves persist both entries and deletion leaves shortcut slots stable', async () => {
  let data: unknown = null;
  let id = 0;
  const store = createStore({ get: async () => data, set: async value => { data = value; } }, () => String(++id), () => {});
  await Promise.all([store.add({ name: 'One', ...capture(selection) }), store.add({ name: 'Two', ...capture({ ...selection, model: 'model-b' }) })]);
  const saved = await store.list();
  expect(saved.map(f => f.slot)).toEqual([1, 2]);
  await store.remove(saved[0]!.id);
  expect((await store.list())[0]?.slot).toBe(2);
  const reopened = createStore({ get: async () => data, set: async value => { data = value; } }, () => '3', () => {});
  expect(await reopened.list()).toEqual(await store.list());
});

test('renaming and reordering persist and missing ids cannot remove another favourite', async () => {
  let data: unknown = null;
  let id = 0;
  const store = createStore({ get: async () => data, set: async value => { data = value; } }, () => String(++id), () => {});
  await store.add({ name: 'One', ...capture(selection) });
  await store.add({ name: 'Two', ...capture({ ...selection, model: 'model-b' }) });
  await store.rename('1', ' Renamed ');
  await store.move('1', 1);
  expect((await store.list()).map(f => f.name)).toEqual(['Two', 'Renamed']);
  await expect(store.remove('missing')).rejects.toThrow('Favourite no longer exists');
  expect(await store.list()).toHaveLength(2);
});


test('concurrent stars of the same model occupy one shortcut slot', async () => {
  let data: unknown = null;
  let id = 0;
  const store = createStore({ get: async () => data, set: async value => { data = value; } }, () => String(++id), () => {});
  await Promise.all([store.add({ name: '', ...capture(selection) }), store.add({ name: '', ...capture(selection) })]);
  expect(await store.list()).toHaveLength(1);
  expect((await store.list())[0]?.slot).toBe(1);
});
