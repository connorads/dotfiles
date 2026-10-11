import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const windowSchema = z.object({
  label: z.string(), usedPercent: z.number(), resetsAt: z.string().nullable(),
  cost: z.object({ usedUsdCents: z.number(), limitUsdCents: z.number() }).nullable(),
});
const usageSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), accountEmail: z.string().nullable(), planLabel: z.string().nullable(), windows: z.array(windowSchema) }),
  z.object({ status: z.literal('not_installed') }),
  z.object({ status: z.literal('unauthenticated') }),
  z.object({ status: z.literal('expired') }),
  z.object({ status: z.literal('error'), message: z.string() }),
]);
const accountSchema = z.object({
  id: z.string(), providerId: z.string(), accountLabel: z.string().nullable(), displayName: z.string(),
  logoUrl: z.string().nullable(), icon: z.object({ glyph: z.string() }).nullable(),
  strings: z.object({ iconTint: z.object({ light: z.string(), dark: z.string() }).nullable() }),
  signInHint: z.string(), expiredHint: z.string(), usage: usageSchema.nullable(),
});
export const snapshotSchema = z.object({ machines: z.array(z.object({
  id: z.string(), displayName: z.string(), status: z.enum(['connected', 'disconnected']),
  providers: z.array(accountSchema), error: z.string().nullable(),
})) });
export const headerSchema = z.object({
  providerId: z.string(), label: z.string(), accountLabel: z.string().nullable(),
  windows: z.array(windowSchema), message: z.string().nullable(),
});
export const rpcContract = defineRpcContract({
  overview: { input: z.object({ refresh: z.boolean() }), output: snapshotSchema },
  header: { input: z.object({ threadId: z.string() }), output: headerSchema },
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Account = z.infer<typeof accountSchema>;
export type UsageWindow = z.infer<typeof windowSchema>;
export type Header = z.infer<typeof headerSchema>;
