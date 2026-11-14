import { expect, test } from 'vitest';
import { accountChips, quickRows, ring, searchGroups, stepEffort, type ProviderCatalog } from './view.ts';

const efforts = (...levels: string[]) => levels.map(reasoningEffort => ({ reasoningEffort }));
const catalog: ProviderCatalog[] = [
  { providerId: 'claude-code', providerName: 'Claude Code', error: null, models: [
    { model: 'opus', displayName: 'Opus', defaultReasoningEffort: 'medium', supportedReasoningEfforts: efforts('low', 'medium', 'high') },
    { model: 'haiku', displayName: 'Haiku', defaultReasoningEffort: 'low', supportedReasoningEfforts: efforts('low') }] },
  { providerId: 'codex', providerName: 'Codex', error: null, models: [
    { model: 'sol', displayName: 'Sol', defaultReasoningEffort: 'low', supportedReasoningEfforts: efforts('low', 'high'),
      supportedServiceTiers: [{ id: 'fast' }], sessionOptions: [{ id: 'daybreak', type: 'boolean', value: false }] }] },
  { providerId: 'pi', providerName: 'Pi', error: 'Sign in required', models: [] },
];
const favourites = [
  { id: 'f2', slot: 2, name: '', providerId: 'claude-code', model: 'opus', reasoningLevel: 'high' },
  { id: 'f1', slot: 1, name: '', providerId: 'codex', model: 'sol' },
];
const current = (providerId: string, model: string, reasoningLevel: string | null = null) =>
  ({ providerId, model, reasoningLevel, serviceTier: null, daybreak: undefined });
const none = () => null;

test('quick rows follow slot order and mark the current favourite with its live effort', () => {
  const rows = quickRows(favourites, catalog, current('claude-code', 'opus', 'low'), none);
  expect(rows.map(r => [r.slot, r.name, r.selected, r.effort])).toEqual([[1, 'Sol', false, null], [2, 'Opus', true, 'low']]);
  expect(rows[1]?.levels).toEqual(['low', 'medium', 'high']);
});

test('a current model that is not a favourite leads the list without a slot', () => {
  const rows = quickRows(favourites, catalog, current('claude-code', 'haiku', 'low'), none);
  expect(rows.map(r => [r.slot, r.name, r.selected])).toEqual([[null, 'Haiku', true], [1, 'Sol', false], [2, 'Opus', false]]);
});

test('a favourite on an unavailable provider keeps its row with the reason', () => {
  const rows = quickRows([{ id: 'p', slot: 3, name: '', providerId: 'gone', model: 'x' }], catalog, current('claude-code', 'opus'), none);
  expect(rows.find(r => r.slot === 3)?.reason).toBe('Provider unavailable on this machine');
});

test('search matches model and provider names, shows saved slots and Daybreak variants', () => {
  const groups = searchGroups(catalog, favourites, 'sol', () => true);
  expect(groups.map(g => [g.provider, g.results.map(r => [r.name, r.slot])])).toEqual([['Codex', [['Sol', 1], ['Sol · Daybreak', null]]]]);
  expect(searchGroups(catalog, favourites, 'claude', () => false).flatMap(g => g.results.map(r => r.name))).toEqual(['Opus', 'Haiku']);
});

test('a failed catalogue appears only when its provider is searched for', () => {
  expect(searchGroups(catalog, favourites, '', () => false).map(g => g.provider)).toEqual(['Claude Code', 'Codex']);
  expect(searchGroups(catalog, favourites, 'pi', () => false).map(g => [g.provider, g.error])).toEqual([['Pi', 'Sign in required']]);
});

test('effort steps within the model levels and starts from the default', () => {
  expect(stepEffort(['low', 'medium', 'high'], null, 1, 'medium')).toBe('high');
  expect(stepEffort(['low', 'medium', 'high'], 'high', 1, 'medium')).toBe('high');
  expect(stepEffort(['low', 'medium', 'high'], 'low', -1, 'medium')).toBe('low');
  expect(stepEffort(['low', 'high'], 'ultra', -1, 'high')).toBe('low');
  expect(stepEffort([], null, 1, 'low')).toBeNull();
});

test('the usage ring shows the fullest window and its tone', () => {
  const usage = (five: number, week: number) => ({ status: 'ok' as const, message: null, observedAt: 0, windows: [
    { id: 'five_hour', label: 'Five hours', usedPercent: five, resetsAt: null, cost: null },
    { id: 'seven_day', label: 'Seven days', usedPercent: week, resetsAt: null, cost: null }] });
  expect(ring(usage(12, 40))).toEqual({ percent: 40, tone: 'normal', label: '5h 12% · week 40%' });
  expect(ring(usage(75, 10)).tone).toBe('warning');
  expect(ring(usage(91, 10)).tone).toBe('critical');
  expect(ring(undefined).tone).toBe('unknown');
});

test('the account row appears only for Claude with more than one account', () => {
  const profiles = [{ id: 'summit', label: 'Summit', configDir: '/s', key: 'S' }, { id: 'trove', label: 'Trove', configDir: '/t', key: 'T' }];
  const accounts = { profiles, currentId: 'summit', pendingId: null };
  expect(accountChips('codex', accounts, {})).toEqual([]);
  expect(accountChips('claude-code', { ...accounts, profiles: profiles.slice(0, 1) }, {})).toEqual([]);
  expect(accountChips('claude-code', { ...accounts, pendingId: 'trove' }, { trove: true })
    .map(c => [c.profile.key, c.selected, c.pending, c.connectors])).toEqual([['S', false, false, false], ['T', true, true, true]]);
});
