import type { Provider } from './records.ts';
import type { UsageRow } from './ledger.ts';
import { findCard, priceGroup, sumParts, type PricedParts, type RateCards } from './prices.ts';

export interface Tokens { input: number; cacheRead: number; cacheWrite: number; output: number }
/** Dollars at API list prices. Unpriced tokens belong to models the price file does not list. */
export interface Cost { usd: number; parts: PricedParts; tokens: Tokens; requests: number; unpricedTokens: number; lastAt: number }
export interface ModelCost extends Cost { model: string; provider: Provider; priced: boolean }
export interface ThreadCost extends Cost { models: ModelCost[] }

export const emptyCost = (): Cost => ({ usd: 0, parts: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, other: 0 },
  tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, requests: 0, unpricedTokens: 0, lastAt: 0 });

function add(into: Cost, row: UsageRow, parts: PricedParts | null) {
  const tokens = row.input + row.cacheRead + row.cacheWrite5m + row.cacheWrite1h + row.output;
  into.tokens.input += row.input; into.tokens.cacheRead += row.cacheRead;
  into.tokens.cacheWrite += row.cacheWrite5m + row.cacheWrite1h; into.tokens.output += row.output;
  into.requests += row.requests;
  into.lastAt = Math.max(into.lastAt, row.lastAt);
  if (!parts) { into.unpricedTokens += tokens; return; }
  into.usd += sumParts(parts);
  for (const key of Object.keys(parts) as (keyof PricedParts)[]) into.parts[key] += parts[key];
}

export function pricer(cards: RateCards) {
  const known = new Map<string, ReturnType<typeof findCard>>();
  return (row: UsageRow): PricedParts | null => {
    if (!known.has(row.model)) known.set(row.model, findCard(cards, row.model));
    const card = known.get(row.model);
    return card ? priceGroup(card, row, { speed: row.speed, over200k: !!row.over200k, over272k: !!row.over272k }) : null;
  };
}

export function threadCost(rows: readonly UsageRow[], cards: RateCards): ThreadCost {
  const price = pricer(cards);
  const total = emptyCost();
  const models = new Map<string, ModelCost>();
  for (const row of rows) {
    const parts = price(row);
    add(total, row, parts);
    const key = `${row.provider}\0${row.model}`;
    const model = models.get(key) ?? { ...emptyCost(), model: row.model, provider: row.provider, priced: parts !== null };
    add(model, row, parts);
    models.set(key, model);
  }
  return { ...total, models: [...models.values()].sort((a, b) => b.usd - a.usd || b.requests - a.requests) };
}

export interface DayCost { day: string; usd: number; byProvider: Partial<Record<Provider, number>> }
export interface ThreadLine extends Cost { threadId: string | null; providers: Provider[] }
export interface Summary {
  total: Cost; days: DayCost[]; models: ModelCost[]; threads: ThreadLine[];
  byProvider: Partial<Record<Provider, number>>;
}

/** Fold priced rows into the page's views. `days` lists every day from `firstDay` to `lastDay`, empty ones included. */
export function summarise(rows: readonly UsageRow[], cards: RateCards, firstDay: string, lastDay: string): Summary {
  const price = pricer(cards);
  const total = emptyCost();
  const days = new Map<string, DayCost>();
  const models = new Map<string, ModelCost>();
  const threads = new Map<string | null, ThreadLine>();
  const byProvider: Partial<Record<Provider, number>> = {};
  for (const row of rows) {
    const parts = price(row);
    const usd = parts ? sumParts(parts) : 0;
    add(total, row, parts);
    byProvider[row.provider] = (byProvider[row.provider] ?? 0) + usd;
    if (row.day) {
      const day = days.get(row.day) ?? { day: row.day, usd: 0, byProvider: {} };
      day.usd += usd;
      day.byProvider[row.provider] = (day.byProvider[row.provider] ?? 0) + usd;
      days.set(row.day, day);
    }
    const modelKey = `${row.provider}\0${row.model}`;
    const model = models.get(modelKey) ?? { ...emptyCost(), model: row.model, provider: row.provider, priced: parts !== null };
    add(model, row, parts);
    models.set(modelKey, model);
    const thread = threads.get(row.threadId) ?? { ...emptyCost(), threadId: row.threadId, providers: [] };
    add(thread, row, parts);
    if (!thread.providers.includes(row.provider)) thread.providers.push(row.provider);
    threads.set(row.threadId, thread);
  }
  const calendar: DayCost[] = [];
  for (let day = firstDay; day <= lastDay; day = nextDay(day)) calendar.push(days.get(day) ?? { day, usd: 0, byProvider: {} });
  return {
    total, days: calendar, byProvider,
    models: [...models.values()].sort((a, b) => b.usd - a.usd || b.requests - a.requests),
    threads: [...threads.values()].sort((a, b) => b.usd - a.usd || b.lastAt - a.lastAt),
  };
}

export function nextDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return localDay(new Date(year, month - 1, date + 1));
}
export const localDay = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
