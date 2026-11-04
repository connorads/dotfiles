import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCard, parseLiteLlm, priceGroup, sumParts } from './prices.ts';

const opus = { mode: 'chat', input_cost_per_token: 4e-6, output_cost_per_token: 2e-5, cache_read_input_token_cost: 2e-7,
  cache_creation_input_token_cost: 5e-6, cache_creation_input_token_cost_above_1hr: 8e-6,
  provider_specific_entry: { fast: 2 }, search_context_cost_per_query: { search_context_size_medium: 0.01 } };
const sol = { mode: 'chat', input_cost_per_token: 2e-6, output_cost_per_token: 1e-5, cache_read_input_token_cost: 1e-7,
  input_cost_per_token_above_272k_tokens: 4e-6, output_cost_per_token_above_272k_tokens: 1.5e-5,
  cache_read_input_token_cost_above_272k_tokens: 2e-7, input_cost_per_token_above_272k_tokens_priority: 8e-6,
  output_cost_per_token_above_272k_tokens_priority: 3e-5, cache_read_input_token_cost_above_272k_tokens_priority: 4e-7 };
const filler = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`model-${i}`, { mode: 'chat', input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 }]));
const cards = parseLiteLlm({ ...filler, 'claude-opus-5-5': opus, 'gpt-6.1-sol': sol, embed: { mode: 'embedding', input_cost_per_token: 1e-7 } });
const standard = { speed: 'standard' as const, over200k: false, over272k: false };

test('a price file keeps chat models and rejects one too small to be real', () => {
  assert.equal(cards.embed, undefined);
  assert.equal(cards['claude-opus-5-5']!.fast_multiplier, 2);
  assert.throws(() => parseLiteLlm({ 'claude-opus-5-5': opus }), /too few/);
  assert.throws(() => parseLiteLlm('nope'), /not a JSON object/);
});

test('model names from logs find their card without date, context tag or provider prefix', () => {
  assert.equal(findCard(cards, 'claude-opus-5-5-20261001'), cards['claude-opus-5-5']);
  assert.equal(findCard(cards, 'claude-opus-5-5[1m]'), cards['claude-opus-5-5']);
  assert.equal(findCard(cards, 'codex-auto-review'), undefined);
});

test('Claude prices 5-minute and 1-hour cache writes separately, and fast mode doubles every rate', () => {
  const group = { input: 1000, cacheRead: 100_000, cacheWrite5m: 2000, cacheWrite1h: 10_000, output: 5000, webSearches: 0 };
  // 1000×4e-6 + 100000×2e-7 + 2000×5e-6 + 10000×8e-6 + 5000×2e-5
  assert.ok(Math.abs(sumParts(priceGroup(cards['claude-opus-5-5']!, group, standard)) - 0.214) < 1e-12);
  assert.ok(Math.abs(sumParts(priceGroup(cards['claude-opus-5-5']!, group, { ...standard, speed: 'fast' })) - 0.428) < 1e-12);
  const search = priceGroup(cards['claude-opus-5-5']!, { ...group, input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0, webSearches: 3 }, standard);
  assert.ok(Math.abs(search.other - 0.03) < 1e-12);
});

test('OpenAI requests past 272k use the long-context rates, and priority uses its own', () => {
  const group = { input: 10_000, cacheRead: 300_000, cacheWrite5m: 0, cacheWrite1h: 0, output: 1000, webSearches: 0 };
  const long = { ...standard, over200k: true, over272k: true };
  assert.ok(Math.abs(sumParts(priceGroup(cards['gpt-6.1-sol']!, group, long)) - 0.115) < 1e-12);
  assert.ok(Math.abs(sumParts(priceGroup(cards['gpt-6.1-sol']!, group, { ...long, speed: 'fast' })) - 0.23) < 1e-12);
  // Past 200k but under 272k stays on standard rates for a model with a 272k tier.
  assert.ok(Math.abs(sumParts(priceGroup(cards['gpt-6.1-sol']!, group, { ...standard, over200k: true })) - 0.06) < 1e-12);
});
