import { z } from 'zod';
const at = z.number().int().nonnegative();
export const diagnosticsSchema = z.object({
  available: z.boolean(),
  state: z.object({ at, state: z.enum(['sleeping', 'listening', 'dictating', 'transcribing', 'stopping']) }).nullable(),
  transcript: z.object({ at, phase: z.enum(['started', 'updated', 'completed']), latency: z.number(), text: z.string() }).nullable(),
  attempts: z.array(z.object({ at, kind: z.enum(['command', 'dictation']), heard: z.string(), command: z.string().nullable(),
    result: z.string(), problem: z.boolean(), unmatched: z.boolean(), context: z.string() })),
});
export type Diagnostics = z.infer<typeof diagnosticsSchema>;
export const unavailableDiagnostics: Diagnostics = { available: false, state: null, transcript: null, attempts: [] };
