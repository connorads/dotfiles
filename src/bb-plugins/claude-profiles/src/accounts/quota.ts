import { z } from 'zod';

export const windowSchema = z.object({
  id: z.string(), label: z.string(), usedPercent: z.number().nonnegative(), resetsAt: z.string().nullable(),
  cost: z.object({ usedUsdCents: z.number().nonnegative(), limitUsdCents: z.number().positive() }).nullable(),
});
export const usageSchema = z.object({
  status: z.enum(['ok', 'unavailable', 'unauthenticated', 'error']),
  windows: z.array(windowSchema), message: z.string().nullable(), observedAt: z.number().nullable(),
});
export type Usage = z.infer<typeof usageSchema>;
const rawUsage = z.object({ rate_limits_available: z.boolean().optional(), rate_limits: z.record(z.string(), z.unknown()).nullable().optional() });
const rawWindow = z.object({ utilization: z.number().finite().nonnegative(), resets_at: z.string().nullable().optional(),
  limit_dollars: z.number().finite().positive().nullable().optional(), used_dollars: z.number().finite().nonnegative().nullable().optional() });
// Claude names new allowances with internal codenames, so only documented windows keep their key as a label.
function label(id: string, credit: boolean): string {
  if (id === 'five_hour') return 'Five hours';
  if (id === 'seven_day') return 'Seven days';
  if (id.startsWith('seven_day_')) return id.replaceAll('_', ' ');
  return credit ? 'Credits' : 'Other limit';
}
export function parseUsage(input: unknown): Usage {
  const parsed = rawUsage.safeParse(input);
  const windows: Usage['windows'] = [];
  if (parsed.success && parsed.data.rate_limits_available !== false) {
    for (const [id, value] of Object.entries(parsed.data.rate_limits ?? {})) {
      if (id === 'extra_usage') continue;
      const window = rawWindow.safeParse(value);
      if (!window.success) continue;
      const { limit_dollars: limit, used_dollars: used } = window.data;
      const cost = limit != null && used != null ? { usedUsdCents: used * 100, limitUsdCents: limit * 100 } : null;
      windows.push({ id, label: label(id, cost !== null), usedPercent: window.data.utilization,
        resetsAt: window.data.resets_at ?? null, cost });
    }
  }
  return windows.length ? { status: 'ok', windows, message: null, observedAt: Date.now() }
    : { status: 'unavailable', windows, message: 'Claude did not return quota windows for this profile.', observedAt: null };
}
