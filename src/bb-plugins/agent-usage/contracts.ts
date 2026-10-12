import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { resetCreditsSchema } from './reset-credits.ts';

const cost = z.object({ usedUsdCents: z.number(), limitUsdCents: z.number() }).nullable();
export const sourceWindowSchema = z.object({ label: z.string(), usedPercent: z.number(), resetsAt: z.string().nullable(), cost });
export const windowSchema = sourceWindowSchema.extend({ period: z.enum(['five-hour', 'day', 'week', 'month']).nullable() });

function snapshotOf<W extends z.ZodType>(window: W) {
  const usage = z.discriminatedUnion('status', [
    z.object({ status: z.literal('ok'), accountEmail: z.string().nullable(), planLabel: z.string().nullable(), windows: z.array(window) }),
    z.object({ status: z.literal('not_installed') }),
    z.object({ status: z.literal('unauthenticated') }),
    z.object({ status: z.literal('expired') }),
    z.object({ status: z.literal('error'), message: z.string() }),
  ]);
  const account = z.object({
    id: z.string(), providerId: z.string(), accountLabel: z.string().nullable(), displayName: z.string(),
    logoUrl: z.string().nullable(), icon: z.object({ glyph: z.string() }).nullable(),
    strings: z.object({ iconTint: z.object({ light: z.string(), dark: z.string() }).nullable() }),
    signInHint: z.string(), expiredHint: z.string(), usage: usage.nullable(),
  });
  return z.object({ machines: z.array(z.object({
    id: z.string(), displayName: z.string(), status: z.enum(['connected', 'disconnected']),
    providers: z.array(account), error: z.string().nullable(),
  })) });
}
/** The BB Provider usage collector's output. */
export const sourceSnapshotSchema = snapshotOf(sourceWindowSchema);
export const snapshotSchema = snapshotOf(windowSchema);
export const headerSchema = z.object({
  providerId: z.string(), label: z.string(), accountLabel: z.string().nullable(),
  windows: z.array(windowSchema), message: z.string().nullable(),
});
export const inspectionSchema = z.object({
  snapshot: snapshotSchema,
  readings: z.array(z.object({ accountId: z.string(), observedAt: z.number().nonnegative().nullable() })),
  resetCredits: z.array(z.object({ hostId: z.string(), reading: resetCreditsSchema })),
});
export const hostContract = defineRpcContract({
  resetCredits: { input: z.object({ refresh: z.boolean() }), output: resetCreditsSchema },
});
export const rpcContract = defineRpcContract({
  overview: { input: z.object({ refresh: z.boolean() }), output: snapshotSchema },
  header: { input: z.object({ threadId: z.string() }), output: headerSchema },
  inspection: { input: z.object({ refresh: z.boolean() }), output: inspectionSchema },
});
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Account = Snapshot['machines'][number]['providers'][number];
export type UsageWindow = z.infer<typeof windowSchema>;
export type Header = z.infer<typeof headerSchema>;
export type Inspection = z.infer<typeof inspectionSchema>;
