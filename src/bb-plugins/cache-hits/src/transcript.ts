import { z } from 'zod';
import type { Sample, Signal } from './cache.ts';

const ttls = { ephemeral_5m_input_tokens: 5 * 60_000, ephemeral_1h_input_tokens: 60 * 60_000 } as const;
const assistant = z.object({
  type: z.literal('assistant'), isSidechain: z.boolean().optional(), timestamp: z.string(),
  message: z.object({ id: z.string(), model: z.string().optional(), usage: z.object({
    input_tokens: z.number(), cache_read_input_tokens: z.number().optional(), cache_creation_input_tokens: z.number().optional(),
    cache_creation: z.object({ ephemeral_5m_input_tokens: z.number().optional(), ephemeral_1h_input_tokens: z.number().optional() }).optional(),
  }) }),
});
// Attachments that change the prompt prefix. Measured on real transcripts: each precedes most warm misses it could explain.
const signals: Record<string, Signal> = {
  deferred_tools_delta: 'tools', mcp_instructions_delta: 'tools', skill_listing: 'tools', credential_org: 'account',
};
const attachment = z.object({ type: z.literal('attachment'), isSidechain: z.boolean().optional(), attachment: z.object({
  type: z.string(), newlyDropped: z.object({ reason: z.string() }).optional() }) });
const boundary = z.object({ type: z.literal('system'), subtype: z.literal('compact_boundary'), isSidechain: z.boolean().optional() });

export const transcriptItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('usage'), id: z.string(),
    sample: z.object({ at: z.number(), prompt: z.number(), read: z.number(), write: z.number(), ttlMs: z.number().nullable(),
      model: z.string().nullable() }) }),
  z.object({ kind: z.literal('reset') }),
  z.object({ kind: z.literal('signal'), signal: z.enum(['tools', 'account', 'prefix']) }),
]);
export type TranscriptItem = z.infer<typeof transcriptItemSchema>;

/**
 * Parse complete lines of a Claude Code session transcript. Claude Code writes one line per
 * content block, so a request repeats with the same message id; callers keep the first.
 * Returns the bytes consumed so a partly written last line is read again next time.
 */
export function parseTranscript(chunk: Buffer): { consumed: number; items: TranscriptItem[] } {
  const end = chunk.lastIndexOf(0x0a) + 1;
  const items: TranscriptItem[] = [];
  for (const line of chunk.subarray(0, end).toString('utf8').split('\n')) {
    if (!line) continue;
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    const marker = boundary.safeParse(value);
    if (marker.success && !marker.data.isSidechain) { items.push({ kind: 'reset' }); continue; }
    const attached = attachment.safeParse(value).data;
    if (attached && !attached.isSidechain) {
      // Claude Code drops thinking blocks with this reason when it sees the cached prefix no longer matches.
      const signal = attached.attachment.newlyDropped?.reason === 'prefix_mismatch' ? 'prefix' : signals[attached.attachment.type];
      if (signal) items.push({ kind: 'signal', signal });
      continue;
    }
    const entry = assistant.safeParse(value).data;
    if (!entry || entry.isSidechain) continue;
    const { usage } = entry.message;
    const read = usage.cache_read_input_tokens ?? 0;
    const write = usage.cache_creation_input_tokens ?? 0;
    // A request that wrote both tiers starts losing cache when the shorter one expires.
    const written = Object.entries(ttls).filter(([field]) => (usage.cache_creation?.[field as keyof typeof ttls] ?? 0) > 0);
    const sample: Sample = { at: Date.parse(entry.timestamp), prompt: usage.input_tokens + read + write, read, write,
      ttlMs: written.length ? Math.min(...written.map(([, ms]) => ms)) : null, model: entry.message.model ?? null };
    items.push({ kind: 'usage', id: entry.message.id, sample });
  }
  return { consumed: end, items };
}
