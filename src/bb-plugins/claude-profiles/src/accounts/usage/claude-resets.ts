import { z } from 'zod';

const groupSchema = z.object({ label: z.string(), count: z.number().int().positive(), usable: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime().nullable(), paused: z.boolean() });
export const claudeResetsSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), observedAt: z.number().nonnegative(), groups: z.array(groupSchema), message: z.string().optional() }),
  z.object({ status: z.literal('unavailable'), message: z.string() }),
]);
export type ClaudeResets = z.infer<typeof claudeResetsSchema>;

const grantSchema = z.object({ resets_left: z.number().int().nonnegative(), ends_at: z.string().nullable(),
  type: z.enum(['session', 'weekly', 'full']), gives_back_weekly: z.boolean(), paused: z.boolean(), usable_now: z.boolean() });
const responseSchema = z.object({ cedar_ember: z.object({ eligible: z.literal(true), grants: z.array(grantSchema) }) });

/** Grant ids authorise redemption and never leave the collector cache. */
export function parseClaudeResets(input: unknown, observedAt: number): ClaudeResets {
  const parsed = responseSchema.safeParse(input);
  if (!parsed.success) return { status: 'unavailable', message: 'Claude reset balance unavailable. Refresh or check Claude Usage.' };
  const groups = new Map<string, z.infer<typeof groupSchema>>();
  for (const grant of parsed.data.cedar_ember.grants) {
    if (grant.resets_left === 0) continue;
    const epoch = grant.ends_at === null ? null : Date.parse(grant.ends_at);
    if (epoch !== null && !Number.isFinite(epoch))
      return { status: 'unavailable', message: 'Claude returned an unreadable reset expiry. Check Claude Usage.' };
    if (epoch !== null && epoch <= observedAt) continue;
    const label = grant.gives_back_weekly ? 'Fable reset' : grant.type === 'session' ? '5-hour reset'
      : grant.type === 'weekly' ? 'Weekly reset' : 'Full reset';
    const expiresAt = epoch === null ? null : new Date(epoch).toISOString();
    const key = JSON.stringify([label, expiresAt, grant.paused]);
    const group = groups.get(key) ?? { label, expiresAt, count: 0, usable: 0, paused: grant.paused };
    group.count += grant.resets_left;
    if (grant.usable_now && !grant.paused) group.usable += grant.resets_left;
    groups.set(key, group);
  }
  return { status: 'ok', observedAt, groups: [...groups.values()].sort((a, b) =>
    (a.expiresAt === null ? Infinity : Date.parse(a.expiresAt)) - (b.expiresAt === null ? Infinity : Date.parse(b.expiresAt))
      || a.label.localeCompare(b.label)) };
}
