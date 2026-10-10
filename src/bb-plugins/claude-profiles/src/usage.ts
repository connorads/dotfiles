import { z } from 'zod';

export const windowSchema = z.object({
  id: z.string(), label: z.string(), usedPercent: z.number().nonnegative(), resetsAt: z.string().nullable(),
});
export const usageSchema = z.object({
  status: z.enum(['ok', 'unavailable', 'unauthenticated', 'error']),
  windows: z.array(windowSchema), message: z.string().nullable(), observedAt: z.number().nullable(),
});
export type Usage = z.infer<typeof usageSchema>;
const rawUsage = z.object({ rate_limits_available: z.boolean().optional(), rate_limits: z.record(z.string(), z.unknown()).nullable().optional() });
const rawWindow = z.object({ utilization: z.number().finite().nonnegative(), resets_at: z.string().nullable().optional() });
export function parseUsage(input: unknown): Usage {
  const parsed = rawUsage.safeParse(input);
  const windows: Usage['windows'] = [];
  if (parsed.success && parsed.data.rate_limits_available !== false) {
    for (const [id, value] of Object.entries(parsed.data.rate_limits ?? {})) {
      if (id === 'extra_usage') continue;
      const window = rawWindow.safeParse(value);
      if (!window.success) continue;
      windows.push({ id, label: id.replace(/^five_hour$/, 'Five hours').replace(/^seven_day$/, 'Seven days').replaceAll('_', ' '),
        usedPercent: window.data.utilization, resetsAt: window.data.resets_at ?? null });
    }
  }
  return windows.length ? { status: 'ok', windows, message: null, observedAt: Date.now() }
    : { status: 'unavailable', windows, message: 'Claude did not return quota windows for this profile.', observedAt: null };
}
