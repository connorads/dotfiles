import { z } from 'zod';

/** Per-request misses at or below this are cache breakpoint granularity noise. */
export const NOISE_FLOOR_TOKENS = 1024;

const sampleSchema = z.object({
  at: z.number(), prompt: z.number(), read: z.number(), write: z.number(),
  // Lifetime of the cache entries this request wrote; null when it wrote none or the provider does not say.
  ttlMs: z.number().nullable(),
});
export type Sample = z.infer<typeof sampleSchema>;
export const cacheStateSchema = z.object({
  last: sampleSchema.nullable(),
  ttlMs: z.number().nullable(),
  prompt: z.number(), read: z.number(),
  misses: z.number(), missedTokens: z.number(),
  lastMiss: z.object({ at: z.number(), tokens: z.number(), idleMs: z.number() }).nullable(),
});
export type CacheState = z.infer<typeof cacheStateSchema>;
export type Usage = { inputTokens: number; cachedInputTokens: number; cacheReadInputTokens?: number; cacheWriteInputTokens?: number };
export type Observation = { kind: 'usage'; sample: Sample } | { kind: 'reset' };

export const initialState = (): CacheState =>
  ({ last: null, ttlMs: null, prompt: 0, read: 0, misses: 0, missedTokens: 0, lastMiss: null });

/** BB's provider-neutral usage. Codex counts cached tokens inside inputTokens; Pi reports them beside it. */
export function bbSample(providerId: string, usage: Usage, at: number): Sample {
  const write = usage.cacheWriteInputTokens ?? 0;
  const read = usage.cacheReadInputTokens ?? Math.max(0, usage.cachedInputTokens - write);
  const prompt = providerId === 'codex' ? usage.inputTokens : usage.inputTokens + usage.cachedInputTokens;
  return { at, prompt, read, write, ttlMs: null };
}

export function observe(state: CacheState, observation: Observation): CacheState {
  if (observation.kind === 'reset') return { ...state, last: null };
  const { sample } = observation;
  if (sample.prompt <= 0) return state;
  const next = { ...state, last: sample, ttlMs: sample.ttlMs ?? state.ttlMs,
    prompt: state.prompt + sample.prompt, read: state.read + sample.read };
  // Tokens the previous request already sent should come back as cache reads.
  const previous = state.last;
  if (!previous) return next;
  const missed = Math.min(previous.prompt, sample.prompt) - sample.read;
  if (missed <= NOISE_FLOOR_TOKENS) return next;
  return { ...next, misses: state.misses + 1, missedTokens: state.missedTokens + missed,
    lastMiss: { at: sample.at, tokens: missed, idleMs: Math.max(0, sample.at - previous.at) } };
}

/** Anthropic refreshes a cache entry's lifetime each time a request reads it. */
export const expiresAt = (state: CacheState) => state.last && state.ttlMs !== null ? state.last.at + state.ttlMs : null;
export const hitRatio = (read: number, prompt: number) => prompt > 0 ? read / prompt : null;
