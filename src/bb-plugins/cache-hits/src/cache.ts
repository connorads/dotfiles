import { z } from 'zod';

/** Per-request misses at or below this are cache breakpoint granularity noise. */
export const NOISE_FLOOR_TOKENS = 1024;

const sampleSchema = z.object({ at: z.number(), prompt: z.number(), read: z.number(), write: z.number() });
export type Sample = z.infer<typeof sampleSchema>;
export const cacheStateSchema = z.object({
  // Claude Code reports one usage event per turn, summed over every request in it.
  granularity: z.enum(['request', 'turn']),
  last: sampleSchema.nullable(),
  pending: z.object({ sample: sampleSchema, since: z.number().nullable() }).nullable(),
  // Context size at the end of the last turn; Claude Code also streams readings mid-turn, which are ignored.
  context: z.number().nullable(),
  prompt: z.number(), read: z.number(),
  misses: z.number(), missedTokens: z.number(),
  lastMiss: z.object({ at: z.number(), tokens: z.number(), idleMs: z.number().nullable() }).nullable(),
});
export type CacheState = z.infer<typeof cacheStateSchema>;
export type Usage = { inputTokens: number; cachedInputTokens: number; cacheReadInputTokens?: number; cacheWriteInputTokens?: number };
export type Observation =
  | { kind: 'usage'; at: number; usage: Usage }
  | { kind: 'context'; used: number | null }
  | { kind: 'reset' };

export function initialState(providerId: string): CacheState {
  return { granularity: providerId === 'claude-code' ? 'turn' : 'request', last: null, pending: null, context: null,
    prompt: 0, read: 0, misses: 0, missedTokens: 0, lastMiss: null };
}

export function toSample(providerId: string, usage: Usage, at: number): Sample {
  const write = usage.cacheWriteInputTokens ?? 0;
  const read = usage.cacheReadInputTokens ?? Math.max(0, usage.cachedInputTokens - write);
  // Codex counts cached tokens inside inputTokens; Claude Code and Pi report them beside it.
  const prompt = providerId === 'codex' ? usage.inputTokens : usage.inputTokens + usage.cachedInputTokens;
  return { at, prompt, read, write };
}

function miss(state: CacheState, tokens: number, at: number, since: number | null): CacheState {
  if (tokens <= NOISE_FLOOR_TOKENS) return state;
  return { ...state, misses: state.misses + 1, missedTokens: state.missedTokens + tokens,
    lastMiss: { at, tokens, idleMs: since === null ? null : Math.max(0, at - since) } };
}

export function observe(state: CacheState, providerId: string, observation: Observation): CacheState {
  if (observation.kind === 'reset') return { ...state, last: null, pending: null, context: null };
  if (observation.kind === 'context') {
    // Turn rule: a warm turn writes about what the context grew by; a cold one also rewrites the old prefix.
    const { pending, context } = state;
    if (!pending) return state;
    const next = { ...state, pending: null, context: observation.used ?? context };
    if (context === null || observation.used === null) return next;
    return miss(next, pending.sample.write - Math.max(0, observation.used - context), pending.sample.at, pending.since);
  }
  const sample = toSample(providerId, observation.usage, observation.at);
  if (sample.prompt <= 0) return state;
  const next = { ...state, last: sample, prompt: state.prompt + sample.prompt, read: state.read + sample.read };
  if (state.granularity === 'turn') return { ...next, pending: { sample, since: state.last?.at ?? null } };
  // Request rule: tokens the previous request already sent should come back as cache reads.
  const previous = state.last;
  if (!previous) return next;
  return miss(next, Math.min(previous.prompt, sample.prompt) - sample.read, sample.at, previous.at);
}

export const hitRatio = (read: number, prompt: number) => prompt > 0 ? read / prompt : null;
