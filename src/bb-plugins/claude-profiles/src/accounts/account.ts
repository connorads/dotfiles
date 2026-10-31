import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const accountSchema = z.object({ accountEmail: z.string().nullable(), planLabel: z.string().nullable() });
export type Account = z.infer<typeof accountSchema>;
const oauthAccount = z.object({ oauthAccount: z.object({
  emailAddress: z.string().nullish(), organizationType: z.string().nullish(), seatTier: z.string().nullish(),
  userRateLimitTier: z.string().nullish(), organizationRateLimitTier: z.string().nullish(),
}) });

export function normaliseClaudePlanLabel(label: string | null): string | null {
  if (label === 'Max (20x)') return 'Ultra';
  if (label === 'Max (5x)') return 'Max';
  return label;
}

/** Claude Code caches the signed-in account, including seat and rate-limit tier, in `.claude.json`. */
export function parseAccount(input: unknown): Account | null {
  const parsed = oauthAccount.safeParse(input);
  if (!parsed.success) return null;
  const account = parsed.data.oauthAccount;
  const multiplier = (account.userRateLimitTier ?? account.organizationRateLimitTier ?? '').match(/max_(\d+)x/u)?.[1];
  const type = account.organizationType?.replace(/^claude_/u, '') ?? null;
  let planLabel: string | null;
  if (type === 'team') planLabel = multiplier ? `Team Premium (${multiplier}x)` : account.seatTier === 'team_standard' ? 'Team Standard' : 'Team';
  else if (multiplier) planLabel = `Max (${multiplier}x)`;
  else planLabel = type ? type.charAt(0).toUpperCase() + type.slice(1) : null;
  return { accountEmail: account.emailAddress ?? null, planLabel: normaliseClaudePlanLabel(planLabel) };
}

export async function readAccount(path: string): Promise<Account | null> {
  try { return parseAccount(JSON.parse(await readFile(path, 'utf8'))); }
  catch { return null; }
}
