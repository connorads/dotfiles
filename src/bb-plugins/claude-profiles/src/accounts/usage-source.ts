import { z } from 'zod';
import type { Usage } from './quota.ts';

const accountFields = {
  plan: z.object({ id: z.string(), multiplier: z.number().int().positive().nullable() }).nullable(),
  accountEmail: z.string().nullable(), planLabel: z.string().nullable(),
};
export const resourceSchema = z.object({
  id: z.string(), accountKey: z.string().nullable(), providerId: z.string(), label: z.string(),
  scope: z.object({ kind: z.literal('host'), hostId: z.string(), hostName: z.string() }),
});
export const measurementSchema = z.object({
  accountKey: z.string().nullable(), observedAt: z.number().nullable(),
  usage: z.discriminatedUnion('status', [
    z.object({ status: z.literal('ok'), ...accountFields, windows: z.array(z.object({
      id: z.string(), label: z.string(), kind: z.enum(['five-hour', 'daily', 'weekly', 'custom']),
      usedPercent: z.number().nonnegative(), resetsAt: z.string().nullable(), model: z.string().nullable(),
      cost: z.object({ usedUsdCents: z.number(), limitUsdCents: z.number() }).nullable(),
    })) }),
    z.object({ status: z.literal('error'), ...accountFields, message: z.string() }),
  ]),
});
export type Measurement = z.infer<typeof measurementSchema>;
export function measurement(value: Usage): Measurement {
  const fields = { plan: null, accountEmail: null, planLabel: null };
  if (value.status !== 'ok') return { accountKey: null, observedAt: value.observedAt,
    usage: { status: 'error', ...fields, message: value.message ?? 'Claude quota unavailable.' } };
  return { accountKey: null, observedAt: value.observedAt, usage: { status: 'ok', ...fields,
    windows: value.windows.map(window => ({ ...window,
      kind: window.id === 'five_hour' ? 'five-hour' : window.id.startsWith('seven_day') ? 'weekly' : 'custom',
      model: window.id.startsWith('seven_day_') ? window.id.slice('seven_day_'.length) : null,
    })),
  } };
}
export const resourceIdSchema = z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]);
export function decodeResourceId(id: string) {
  let value: unknown;
  try { value = JSON.parse(id); } catch { throw new Error('Invalid usage resource ID.'); }
  const parsed = resourceIdSchema.safeParse(value);
  if (!parsed.success) throw new Error('Invalid usage resource ID.');
  return parsed.data;
}
