import { z } from 'zod';
export const labSchema = z.object({
  id: z.string().regex(/^bb-patch-lab-[a-z0-9_]+$/),
  phase: z.enum(['created', 'preparing', 'ready', 'rehearsing', 'checks-pending', 'blocked', 'interrupted', 'stopped']),
  revision: z.number().int().nonnegative(), events: z.array(z.string().max(500)).max(30),
  checks: z.record(z.string(), z.enum(['passed', 'not-checked', 'failed'])),
  liveActivation: z.literal(false), root: z.string(),
});
export const labStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('available'), lab: labSchema }),
  z.object({ kind: z.literal('unavailable'), reason: z.string() }),
]);
export const labActionSchema = z.object({ id: labSchema.shape.id, revision: z.number().int().nonnegative() }).strict();
export type LabState = z.infer<typeof labStateSchema>;
