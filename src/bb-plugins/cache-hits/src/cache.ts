import { z } from 'zod';

/** Per-request misses at or below this are cache breakpoint granularity noise. */
export const NOISE_FLOOR_TOKENS = 1024;

const sampleSchema = z.object({
  at: z.number(), prompt: z.number(), read: z.number(), write: z.number(),
  // Lifetime of the cache entries this request wrote; null when it wrote none or the provider does not say.
  ttlMs: z.number().nullable(),
});
export type Sample = z.infer<typeof sampleSchema>;
/** Requests kept for the popover's chart; enough to span a working session without bloating plugin storage. */
export const HISTORY_LIMIT = 48;
const missSchema = z.object({ tokens: z.number(), idleMs: z.number(), cause: z.enum(['idle', 'account']).default('idle') });
const entrySchema = z.object({
  at: z.number(), prompt: z.number(), read: z.number(), write: z.number(),
  miss: missSchema.nullable(),
  // First request after compaction or a context clear: a smaller prompt here is expected, not a miss.
  afterReset: z.boolean(),
});
export type HistoryEntry = z.infer<typeof entrySchema>;
export const cacheStateSchema = z.object({
  last: sampleSchema.nullable(),
  ttlMs: z.number().nullable(),
  prompt: z.number(), read: z.number(),
  misses: z.number(), missedTokens: z.number(),
  lastMiss: missSchema.extend({ at: z.number() }).nullable(),
  // When an account switch emptied the cache; the next request clears it.
  invalidatedAt: z.number().nullable().default(null),
  history: z.array(entrySchema).default([]),
});
export type CacheState = z.infer<typeof cacheStateSchema>;
export type Usage = { inputTokens: number; cachedInputTokens: number; cacheReadInputTokens?: number; cacheWriteInputTokens?: number };
// Anthropic keeps each account's prompt cache separate, so switching account invalidates it.
export type Observation = { kind: 'usage'; sample: Sample } | { kind: 'reset' } | { kind: 'invalidate'; at: number };

export const initialState = (): CacheState =>
  ({ last: null, ttlMs: null, prompt: 0, read: 0, misses: 0, missedTokens: 0, lastMiss: null, invalidatedAt: null, history: [] });

/** BB's provider-neutral usage. Codex counts cached tokens inside inputTokens; Pi reports them beside it. */
export function bbSample(providerId: string, usage: Usage, at: number): Sample {
  const write = usage.cacheWriteInputTokens ?? 0;
  const read = usage.cacheReadInputTokens ?? Math.max(0, usage.cachedInputTokens - write);
  const prompt = providerId === 'codex' ? usage.inputTokens : usage.inputTokens + usage.cachedInputTokens;
  return { at, prompt, read, write, ttlMs: null };
}

export function observe(state: CacheState, observation: Observation): CacheState {
  if (observation.kind === 'reset') return { ...state, last: null };
  if (observation.kind === 'invalidate') return { ...state, invalidatedAt: observation.at };
  const { sample } = observation;
  if (sample.prompt <= 0) return state;
  const previous = state.last;
  // Tokens the previous request already sent should come back as cache reads.
  const missed = previous ? Math.min(previous.prompt, sample.prompt) - sample.read : 0;
  const miss = previous && missed > NOISE_FLOOR_TOKENS
    ? { tokens: missed, idleMs: Math.max(0, sample.at - previous.at), cause: state.invalidatedAt === null ? 'idle' as const : 'account' as const }
    : null;
  const entry = { at: sample.at, prompt: sample.prompt, read: sample.read, write: sample.write, miss,
    afterReset: !previous && state.history.length > 0 };
  const next = { ...state, last: sample, ttlMs: sample.ttlMs ?? state.ttlMs,
    prompt: state.prompt + sample.prompt, read: state.read + sample.read, invalidatedAt: null,
    history: [...state.history, entry].slice(-HISTORY_LIMIT) };
  if (!miss) return next;
  return { ...next, misses: state.misses + 1, missedTokens: state.missedTokens + missed, lastMiss: { at: sample.at, ...miss } };
}

/** Anthropic refreshes a cache entry's lifetime each time a request reads it. */
export function expiresAt(state: CacheState) {
  if (!state.last || state.ttlMs === null) return null;
  const expiry = state.last.at + state.ttlMs;
  return state.invalidatedAt === null ? expiry : Math.min(expiry, state.invalidatedAt);
}
export const hitRatio = (read: number, prompt: number) => prompt > 0 ? read / prompt : null;
