import { z } from 'zod';
import { accountSchema } from './account.ts';

export const windowSchema = z.object({
  id: z.string(), label: z.string(), usedPercent: z.number().nonnegative(), resetsAt: z.string().nullable(),
  cost: z.object({ usedUsdCents: z.number().nonnegative(), limitUsdCents: z.number().positive() }).nullable(),
});
export const usageSchema = z.object({
  status: z.enum(['ok', 'not_installed', 'unauthenticated', 'error']),
  windows: z.array(windowSchema), message: z.string().nullable(), observedAt: z.number().nullable(),
  account: accountSchema.nullable().optional(),
  /** Reported fields with a value that the parser neither read nor ignores on purpose. */
  unread: z.array(z.string()).optional(),
});
export type Usage = z.infer<typeof usageSchema>;
const rawUsage = z.object({ rate_limits_available: z.boolean().optional(), rate_limits: z.record(z.string(), z.unknown()).nullable().optional() });
const rawWindow = z.object({ utilization: z.number().finite().nonnegative(), resets_at: z.string().nullable().optional(),
  limit_dollars: z.number().finite().positive().nullable().optional(), used_dollars: z.number().finite().nonnegative().nullable().optional() });
const scopedLimit = z.object({ kind: z.literal('weekly_scoped'), percent: z.number().finite().nonnegative(),
  resets_at: z.string().nullable().optional(), scope: z.object({ model: z.object({ display_name: z.string().trim().min(1) }) }) });
// Claude names new allowances with internal codenames, so only documented windows keep their key as a label.
function label(id: string, credit: boolean): string {
  if (id === 'five_hour') return 'Five hours';
  if (id === 'seven_day') return 'Seven days';
  if (id.startsWith('seven_day_')) return id.replaceAll('_', ' ');
  return credit ? 'Credits' : 'Other limit';
}
// Reported fields that hold no quota of their own. Anything else that carries a value and becomes no window is unread.
const IGNORED = new Set([
  'extra_usage', // Paid overage, not a subscription window.
  'spend', 'member_dashboard_available', // Billing and admin state.
  'model_scoped', 'weekly_scoped_shares', // Restate the scoped entries in `limits`.
  'seven_day_breakdown', // Splits `seven_day` by surface, not a separate limit.
]);
// `session` and `weekly_all` restate `five_hour` and `seven_day`.
const READ_LIMIT_KINDS = new Set(['session', 'weekly_all', 'weekly_scoped']);
const limitKind = z.object({ kind: z.string() });
export function parseUsage(input: unknown): Usage {
  const parsed = rawUsage.safeParse(input);
  const windows: Usage['windows'] = [];
  const unread: string[] = [];
  if (parsed.success && parsed.data.rate_limits_available !== false) {
    for (const [id, value] of Object.entries(parsed.data.rate_limits ?? {})) {
      if (value === null || IGNORED.has(id) || id === 'limits') continue;
      const window = rawWindow.safeParse(value);
      if (!window.success) { unread.push(id); continue; }
      const { limit_dollars: limit, used_dollars: used } = window.data;
      const cost = limit != null && used != null ? { usedUsdCents: used * 100, limitUsdCents: limit * 100 } : null;
      windows.push({ id, label: label(id, cost !== null), usedPercent: window.data.utilization,
        resetsAt: window.data.resets_at ?? null, cost });
    }
    // Some model allowances, such as Fable, appear only as scoped entries in this list, never as a `seven_day_*` key.
    const limits = z.array(z.unknown()).catch([]).parse(parsed.data.rate_limits?.limits ?? []);
    for (const entry of limits) {
      const kind = limitKind.safeParse(entry);
      if (kind.success && !READ_LIMIT_KINDS.has(kind.data.kind) && !unread.includes(`limits.${kind.data.kind}`)) unread.push(`limits.${kind.data.kind}`);
      const limit = scopedLimit.safeParse(entry);
      if (!limit.success) continue;
      const name = limit.data.scope.model.display_name;
      const id = `seven_day_${name.toLowerCase()}`;
      if (windows.some(window => window.id === id)) continue;
      windows.push({ id, label: name, usedPercent: limit.data.percent, resetsAt: limit.data.resets_at ?? null, cost: null });
    }
  }
  // A signed-out profile also answers with no windows; the caller tells the two apart with the login status.
  return { status: 'ok', windows, message: windows.length ? null : 'No limits reported', observedAt: Date.now(), unread };
}
