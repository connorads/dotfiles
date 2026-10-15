import { z } from 'zod';

/** Per-request misses at or below this are cache breakpoint granularity noise. */
export const NOISE_FLOOR_TOKENS = 1024;
/**
 * A miss must also lose this share of the prefix both requests sent. Smaller gaps are partial hits:
 * OpenAI often serves part of a warm prefix, and Claude Code trims old tool results mid-prefix.
 */
export const MISS_SHARE = 0.25;

const sampleSchema = z.object({
  at: z.number(), prompt: z.number(), read: z.number(), write: z.number(),
  // Lifetime of the cache entries this request wrote; null when it wrote none or the provider does not say.
  ttlMs: z.number().nullable(),
  // Each model keeps its own cache. Null when the provider does not say.
  model: z.string().nullable().default(null),
});
export type Sample = z.infer<typeof sampleSchema>;
/** Requests kept for the popover's chart; enough to span a working session without bloating plugin storage. */
export const HISTORY_LIMIT = 48;
/** What a transcript says changed between two requests; each change rewrites the cache from that point. */
export type Signal = 'tools' | 'account' | 'prefix';
/** `idle` is the fallback: nothing explains the miss, so only the idle gap is shown. */
export const missCauses = ['idle', 'expired', 'model', 'account', 'tools', 'prefix'] as const;
export type MissCause = typeof missCauses[number];
const missSchema = z.object({ tokens: z.number(), idleMs: z.number(), cause: z.enum(missCauses).default('idle') });
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
  // Signals seen since the last request; the next request takes its miss cause from them.
  pending: z.array(z.enum(['tools', 'account', 'prefix'])).default([]),
});
export type CacheState = z.infer<typeof cacheStateSchema>;
export type Usage = { inputTokens: number; cachedInputTokens: number; cacheReadInputTokens?: number; cacheWriteInputTokens?: number };
// Anthropic keeps each account's prompt cache separate, so switching account invalidates it.
export type Observation = { kind: 'usage'; sample: Sample } | { kind: 'reset' } | { kind: 'invalidate'; at: number }
  | { kind: 'signal'; signal: Signal };

export const initialState = (): CacheState =>
  ({ last: null, ttlMs: null, prompt: 0, read: 0, misses: 0, missedTokens: 0, lastMiss: null, invalidatedAt: null, history: [], pending: [] });

/** BB's provider-neutral usage. Codex counts cached tokens inside inputTokens; Pi reports them beside it. */
export function bbSample(providerId: string, usage: Usage, at: number): Sample {
  const write = usage.cacheWriteInputTokens ?? 0;
  const read = usage.cacheReadInputTokens ?? Math.max(0, usage.cachedInputTokens - write);
  const prompt = providerId === 'codex' ? usage.inputTokens : usage.inputTokens + usage.cachedInputTokens;
  return { at, prompt, read, write, ttlMs: null, model: null };
}

export function observe(state: CacheState, observation: Observation): CacheState {
  if (observation.kind === 'reset') return { ...state, last: null, pending: [] };
  if (observation.kind === 'invalidate') return { ...state, invalidatedAt: observation.at };
  if (observation.kind === 'signal') return state.pending.includes(observation.signal) ? state
    : { ...state, pending: [...state.pending, observation.signal] };
  const { sample } = observation;
  if (sample.prompt <= 0) return state;
  const previous = state.last;
  // Tokens the previous request already sent should come back as cache reads.
  const missed = previous ? Math.min(previous.prompt, sample.prompt) - sample.read : 0;
  const miss = previous && missed > NOISE_FLOOR_TOKENS && missed > MISS_SHARE * Math.min(previous.prompt, sample.prompt)
    ? { tokens: missed, idleMs: Math.max(0, sample.at - previous.at), cause: missCause(state, previous, sample) }
    : null;
  const entry = { at: sample.at, prompt: sample.prompt, read: sample.read, write: sample.write, miss,
    afterReset: !previous && state.history.length > 0 };
  const next = { ...state, last: sample, ttlMs: sample.ttlMs ?? state.ttlMs,
    prompt: state.prompt + sample.prompt, read: state.read + sample.read, invalidatedAt: null, pending: [],
    history: [...state.history, entry].slice(-HISTORY_LIMIT) };
  if (!miss) return next;
  return { ...next, misses: state.misses + 1, missedTokens: state.missedTokens + missed, lastMiss: { at: sample.at, ...miss } };
}

/**
 * The likeliest cause, most certain first. Expiry outranks transcript signals because a resumed
 * session re-sends its account and tool list whether or not the cache was still warm.
 */
function missCause(state: CacheState, previous: Sample, sample: Sample): MissCause {
  if (previous.model && sample.model && previous.model !== sample.model) return 'model';
  if (state.ttlMs !== null && sample.at - previous.at > state.ttlMs) return 'expired';
  if (state.invalidatedAt !== null || state.pending.includes('account')) return 'account';
  if (state.pending.includes('tools')) return 'tools';
  if (state.pending.includes('prefix')) return 'prefix';
  return 'idle';
}

/** Anthropic refreshes a cache entry's lifetime each time a request reads it. */
export function expiresAt(state: CacheState) {
  if (!state.last || state.ttlMs === null) return null;
  const expiry = state.last.at + state.ttlMs;
  return state.invalidatedAt === null ? expiry : Math.min(expiry, state.invalidatedAt);
}
export const hitRatio = (read: number, prompt: number) => prompt > 0 ? read / prompt : null;
