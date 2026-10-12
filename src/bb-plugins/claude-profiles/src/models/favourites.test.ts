import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availability, capture, matches, nextFavourite, planSelection } from './favourites.ts';

const selection = { providerId: 'codex', model: 'model-a', reasoningLevel: 'high' as const, serviceTier: 'fast', permissionMode: 'full' as const };
const favourite = { id: 'a', slot: 1, name: 'Deep', ...capture(selection) };
const efforts = (...levels: ('low' | 'high')[]) => levels.map(reasoningEffort => ({ reasoningEffort }));
const model = { model: 'model-a', defaultReasoningEffort: 'high' as const, supportedReasoningEfforts: efforts('low', 'high') };
const catalog = { available: true, error: null, models: [model] };

test('favourites capture only provider and model', () => {
  assert.deepEqual(capture({ ...selection, projectId: 'project' }), { providerId: 'codex', model: 'model-a' });
});

test('favourites match the model independently of effort and tier', () => {
  assert.equal(matches(favourite, selection), true);
  assert.equal(matches(favourite, { ...selection, reasoningLevel: 'low', serviceTier: 'default' }), true);
});

test('cycling wraps and skips unavailable entries while keeping saved order', () => {
  const other = { ...favourite, id: 'b', slot: 3, model: 'model-b' };
  const last = { ...favourite, id: 'c', slot: 5, model: 'model-c' };
  const list = [favourite, other, last];
  assert.equal(nextFavourite(list, selection, 1, f => f.id === 'b' ? 'Missing model' : null)?.id, 'c');
  assert.equal(nextFavourite(list, selection, -1, () => null)?.id, 'c');
  assert.equal(nextFavourite(list, { ...selection, model: 'custom' }, 1, () => null)?.id, 'a');
  assert.equal(nextFavourite(list, selection, 1, () => 'Offline'), null);
});

test('availability distinguishes catalogue failure, a missing model and an unsupported saved effort', () => {
  assert.equal(availability(favourite, catalog), null);
  assert.equal(availability({ ...favourite, reasoningLevel: 'low', serviceTier: 'fast' }, catalog), null);
  assert.equal(availability(favourite, { ...catalog, error: 'Sign in required', models: [] }), 'Sign in required');
  assert.match(availability(favourite, { ...catalog, models: [] }) ?? '', /Model unavailable/);
  assert.match(availability(favourite, { ...catalog, available: false }) ?? '', /Provider unavailable/);
  assert.equal(availability({ ...favourite, reasoningLevel: 'ultra' }, catalog), 'Saved effort ultra is not available for this model');
});

test('selection uses the saved effort, else the model default, and never the current effort', () => {
  assert.deepEqual(planSelection({ ...favourite, reasoningLevel: 'low' }, model), { providerId: 'codex', model: 'model-a', reasoningLevel: 'low' });
  assert.deepEqual(planSelection(favourite, model), { providerId: 'codex', model: 'model-a', reasoningLevel: 'high' });
  assert.deepEqual(planSelection(favourite, { ...model, defaultReasoningEffort: 'low' }), { providerId: 'codex', model: 'model-a', reasoningLevel: 'low' });
  assert.throws(() => planSelection({ ...favourite, reasoningLevel: 'ultra' }, model), /Saved effort ultra/);
});

test('cycling skips a favourite whose saved effort the model does not support', () => {
  const unsupported = { ...favourite, id: 'b', slot: 2, model: 'model-b', reasoningLevel: 'ultra' as const };
  const plain = { ...favourite, id: 'c', slot: 3, model: 'model-c' };
  const all = { ...catalog, models: ['model-a', 'model-b', 'model-c'].map(name => ({ ...model, model: name })) };
  assert.equal(nextFavourite([favourite, unsupported, plain], selection, 1, f => availability(f, all))?.id, 'c');
});
