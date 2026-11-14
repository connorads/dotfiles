import { z } from 'zod';

/** The folder picker's `select` inputs, so a recent pick is checked again like a fresh one. */
export const pickSchema = z.object({ path: z.string().min(1), worktree: z.string().min(1).optional() });
export type Pick = z.infer<typeof pickSchema>;
const MAX = 8;

export const parsePicks = (stored: unknown): Pick[] => z.array(pickSchema).max(MAX).safeParse(stored).data ?? [];

export function addPick(picks: readonly Pick[], pick: Pick): Pick[] {
  const same = (other: Pick) => other.path === pick.path && other.worktree === pick.worktree;
  return [pick, ...picks.filter(other => !same(other))].slice(0, MAX);
}
