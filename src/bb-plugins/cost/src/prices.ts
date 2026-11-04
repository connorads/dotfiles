import type { Speed } from './records.ts';

/** The per-token fields a rate card keeps from LiteLLM's price file, by their LiteLLM names. */
export type RateCard = Record<string, number>;
export type RateCards = Record<string, RateCard>;

export const priceSourceUrl = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/**
 * Keep chat models with numeric input and output prices. Any other entry is skipped, and a file with
 * fewer than 50 usable models is rejected so a broken or truncated download never replaces good prices.
 */
export function parseLiteLlm(raw: unknown): RateCards {
  if (raw === null || typeof raw !== 'object') throw new Error('Price file is not a JSON object.');
  const cards: RateCards = {};
  for (const [model, entry] of Object.entries(raw)) {
    if (entry === null || typeof entry !== 'object') continue;
    const fields = entry as Record<string, unknown>;
    if (fields.mode !== 'chat' && fields.mode !== 'responses') continue;
    if (typeof fields.input_cost_per_token !== 'number' || typeof fields.output_cost_per_token !== 'number') continue;
    const card: RateCard = {};
    for (const [name, value] of Object.entries(fields))
      if (name.includes('cost') && typeof value === 'number' && Number.isFinite(value) && value >= 0) card[name] = value;
    const search = fields.search_context_cost_per_query as Record<string, unknown> | undefined;
    if (typeof search?.search_context_size_medium === 'number') card.web_search_cost = search.search_context_size_medium;
    const fast = (fields.provider_specific_entry as Record<string, unknown> | undefined)?.fast;
    if (typeof fast === 'number' && fast > 0) card.fast_multiplier = fast;
    cards[model] = card;
  }
  if (Object.keys(cards).length < 50) throw new Error('Price file has too few usable models.');
  return cards;
}

/** Find a model's card under the names logs use: dated, suffixed with a context tag, or without a provider prefix. */
export function findCard(cards: RateCards, model: string): RateCard | undefined {
  const base = model.toLowerCase().replace(/\[[^\]]*\]$/, '');
  const undated = base.replace(/-\d{8}$/, '');
  for (const name of [model, base, undated, `anthropic/${undated}`, `openai/${undated}`]) {
    const card = cards[name];
    if (card) return card;
  }
  return undefined;
}

export interface TokenGroup {
  input: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number; output: number; webSearches: number;
}
export interface Flags { speed: Speed; over200k: boolean; over272k: boolean }
export interface PricedParts { input: number; cacheRead: number; cacheWrite: number; output: number; other: number }

/**
 * Price a group of requests that share a model, speed and context tier. A whole request moves to the
 * long-context rates once its prompt passes the model's threshold, so the tier is a per-request flag.
 */
export function priceGroup(card: RateCard, group: TokenGroup, flags: Flags): PricedParts {
  const long = Object.keys(card).some(name => name.includes('_above_272k_tokens')) ? flags.over272k
    : Object.keys(card).some(name => name.includes('_above_200k_tokens')) ? flags.over200k : false;
  const tier = long ? (card.input_cost_per_token_above_272k_tokens !== undefined ? '_above_272k_tokens' : '_above_200k_tokens') : '';
  const fast = flags.speed === 'fast';
  const rate = (field: string): number => {
    // OpenAI publishes priority rates; Anthropic publishes a multiplier for fast mode.
    const candidates = fast ? [`${field}${tier}_priority`, `${field}_priority`] : [];
    for (const name of candidates) if (card[name] !== undefined) return card[name];
    const standard = card[`${field}${tier}`] ?? card[field];
    if (standard === undefined) return NaN;
    return fast ? standard * (card.fast_multiplier ?? 1) : standard;
  };
  const input = rate('input_cost_per_token');
  const read = rate('cache_read_input_token_cost');
  const write = rate('cache_creation_input_token_cost');
  // Anthropic bills 1-hour cache writes at twice the input rate where LiteLLM omits the field.
  const hour = card.cache_creation_input_token_cost_above_1hr !== undefined
    ? card.cache_creation_input_token_cost_above_1hr * (fast ? card.fast_multiplier ?? 1 : 1) : input * 2;
  const or = (value: number, fallback: number) => Number.isNaN(value) ? fallback : value;
  return {
    input: group.input * input,
    cacheRead: group.cacheRead * or(read, input),
    cacheWrite: group.cacheWrite5m * or(write, input * 1.25) + group.cacheWrite1h * hour,
    output: group.output * rate('output_cost_per_token'),
    other: group.webSearches * (card.web_search_cost ?? 0),
  };
}

export const sumParts = (parts: PricedParts) => parts.input + parts.cacheRead + parts.cacheWrite + parts.output + parts.other;
