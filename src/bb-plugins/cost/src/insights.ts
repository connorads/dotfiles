import { providers, type Provider } from './records.ts';
import type { UsageRow } from './ledger.ts';
import { pricer } from './report.ts';
import { sumParts, type RateCards } from './prices.ts';

/** One BB thread, or a thread with its sub-threads folded in, over the chosen period. */
export interface InsightPoint {
  threadId: string; title: string; provider: Provider; usd: number;
  requests: number; turns: number; peakContext: number; subThreads: number;
}
export type Metric = 'requests' | 'turns' | 'peakContext';

/** Follow parent links to the thread that started the chain. Bounded, so a cycle in bad data cannot hang. */
export function rootOf(parents: ReadonlyMap<string, string>, threadId: string): string {
  let current = threadId;
  for (let hop = 0; hop < 32; hop += 1) {
    const parent = parents.get(current);
    if (!parent) return current;
    current = parent;
  }
  return current;
}

/** Fold each sub-thread into its root: cost, requests and turns add up; peak context is the largest any thread reached. */
export function foldThreads(points: readonly InsightPoint[], parents: ReadonlyMap<string, string>,
  describe: (threadId: string) => { title: string; provider: Provider } | undefined): InsightPoint[] {
  const roots = new Map<string, InsightPoint>();
  for (const point of points) {
    const id = rootOf(parents, point.threadId);
    const known = roots.get(id);
    if (!known) {
      const info = id === point.threadId ? point : describe(id) ?? point;
      roots.set(id, { ...point, threadId: id, title: info.title, provider: info.provider, subThreads: id === point.threadId ? 0 : 1 });
      continue;
    }
    known.usd += point.usd; known.requests += point.requests; known.turns += point.turns;
    known.peakContext = Math.max(known.peakContext, point.peakContext);
    known.subThreads += 1;
  }
  return [...roots.values()];
}

export function quantile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  return sorted[low]! + (sorted[Math.ceil(index)]! - sorted[low]!) * (index - low);
}

export interface Stats { count: number; total: number; mean: number; median: number; p90: number; max: number; topTenShare: number }
export function stats(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const top = sorted.slice(sorted.length - Math.ceil(sorted.length / 10)).reduce((sum, value) => sum + value, 0);
  return { count: sorted.length, total, mean: sorted.length ? total / sorted.length : 0, median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9), max: sorted[sorted.length - 1] ?? 0, topTenShare: total ? top / total : 0 };
}

/** Thread cost in decades, since costs span four orders of magnitude. */
export const costBins = [
  { label: 'Under 10¢', lo: 0, hi: 0.1 }, { label: '10¢–$1', lo: 0.1, hi: 1 }, { label: '$1–10', lo: 1, hi: 10 },
  { label: '$10–100', lo: 10, hi: 100 }, { label: '$100+', lo: 100, hi: Infinity },
] as const;
export function histogram(points: readonly InsightPoint[]) {
  return costBins.map(bin => {
    const inside = points.filter(point => point.usd >= bin.lo && point.usd < bin.hi);
    return { ...bin, count: inside.length, usd: inside.reduce((sum, point) => sum + point.usd, 0) };
  });
}

export const lengthBands: Record<Metric, { label: string; lo: number; hi: number }[]> = {
  requests: [{ label: '1–10', lo: 1, hi: 10 }, { label: '11–50', lo: 11, hi: 50 }, { label: '51–200', lo: 51, hi: 200 },
    { label: '201–1,000', lo: 201, hi: 1000 }, { label: '1,000+', lo: 1001, hi: Infinity }],
  turns: [{ label: '1', lo: 1, hi: 1 }, { label: '2–5', lo: 2, hi: 5 }, { label: '6–20', lo: 6, hi: 20 },
    { label: '21–50', lo: 21, hi: 50 }, { label: '50+', lo: 51, hi: Infinity }],
  peakContext: [{ label: 'Under 50k', lo: 0, hi: 49_999 }, { label: '50k–150k', lo: 50_000, hi: 149_999 },
    { label: '150k–300k', lo: 150_000, hi: 299_999 }, { label: '300k–600k', lo: 300_000, hi: 599_999 },
    { label: '600k+', lo: 600_000, hi: Infinity }],
};

/** Median cost and cost per request in each length band. Cost per request shows where long threads get dearer. */
export function byLength(points: readonly InsightPoint[], metric: Metric) {
  return lengthBands[metric].map(band => {
    const inside = points.filter(point => point[metric] >= band.lo && point[metric] <= band.hi);
    const usd = inside.reduce((sum, point) => sum + point.usd, 0);
    const requests = inside.reduce((sum, point) => sum + point.requests, 0);
    return { ...band, count: inside.length, median: quantile(inside.map(point => point.usd).sort((a, b) => a - b), 0.5),
      perRequest: requests ? usd / requests : 0 };
  });
}

export function byProvider(points: readonly InsightPoint[]) {
  return providers.flatMap(provider => {
    const values = points.filter(point => point.provider === provider).map(point => point.usd);
    return values.length ? [{ provider, ...stats(values) }] : [];
  });
}

/** Each request's cost, in order. Unpriced requests count as zero. */
export function requestCosts(rows: readonly UsageRow[], cards: RateCards): number[] {
  const price = pricer(cards);
  return rows.map(row => { const parts = price(row); return parts ? sumParts(parts) : 0; });
}

/** How much dearer the thread's last tenth of requests ran than its first tenth, on average. Null for short threads. */
export function growth(costs: readonly number[]): number | null {
  if (costs.length < 20) return null;
  const tenth = Math.max(1, Math.floor(costs.length / 10));
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const first = mean(costs.slice(0, tenth));
  return first > 0 ? mean(costs.slice(-tenth)) / first : null;
}

/** Average consecutive requests into at most `limit` points, so a long thread draws a readable line. */
export function downsample(costs: readonly number[], limit = 160): { index: number; usd: number }[] {
  if (costs.length <= limit) return costs.map((usd, index) => ({ index: index + 1, usd }));
  const size = costs.length / limit;
  return Array.from({ length: limit }, (_, bucket) => {
    const slice = costs.slice(Math.floor(bucket * size), Math.floor((bucket + 1) * size));
    return { index: Math.round((bucket + 0.5) * size), usd: slice.reduce((sum, value) => sum + value, 0) / slice.length };
  });
}
