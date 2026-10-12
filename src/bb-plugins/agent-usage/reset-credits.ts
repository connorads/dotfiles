import { z } from 'zod';

export const resetCreditsSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), accountLabel: z.string().nullable(), observedAt: z.number().nonnegative(),
    held: z.number().int().nonnegative(), usable: z.number().int().nonnegative(),
    expiries: z.array(z.object({ count: z.number().int().positive(), expiresAt: z.iso.datetime() })),
    unknownExpiryCount: z.number().int().nonnegative(), message: z.string().optional() }),
  z.object({ status: z.literal('unavailable'), message: z.string() }),
]);
export type ResetCredits = z.infer<typeof resetCreditsSchema>;

const countsSchema = z.object({ available_count: z.number().int().nonnegative(),
  applicable_available_count: z.number().int().nonnegative() })
  .refine(counts => counts.applicable_available_count <= counts.available_count);
const cacheSchema = z.object({ email: z.string().optional(), rate_limit_reset_credits: countsSchema });
const detailsSchema = z.object({ _reset_credit_details: z.object({ credits: z.array(z.unknown()) }) });
const grantSchema = z.object({ status: z.literal('available'), expires_at: z.string() });

/** Counts survive missing grant details; only provider-supplied dates become deadlines. */
export function parseResetCredits(input: unknown, observedAt: number): ResetCredits {
  const cache = cacheSchema.safeParse(input);
  if (!cache.success) return { status: 'unavailable', message: 'Reset credits not reported by the tmux usage cache.' };
  const { available_count: held, applicable_available_count: usable } = cache.data.rate_limit_reset_credits;
  const details = detailsSchema.safeParse(input);
  const dates = details.success ? details.data._reset_credit_details.credits.flatMap(value => {
    const grant = grantSchema.safeParse(value);
    if (!grant.success) return [];
    const epoch = Date.parse(grant.data.expires_at);
    return Number.isFinite(epoch) ? [epoch] : [];
  }) : [];
  // Counts and grant details come from separate requests. Disagreement must not fabricate a grant list.
  const grouped = new Map<number, number>();
  if (dates.length <= held) for (const date of dates) grouped.set(date, (grouped.get(date) ?? 0) + 1);
  const expiries = [...grouped].sort(([a], [b]) => a - b)
    .map(([date, count]) => ({ count, expiresAt: new Date(date).toISOString() }));
  return { status: 'ok', accountLabel: cache.data.email || null, observedAt, held, usable, expiries,
    unknownExpiryCount: held - expiries.reduce((total, expiry) => total + expiry.count, 0) };
}
