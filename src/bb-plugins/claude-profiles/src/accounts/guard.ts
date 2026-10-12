// BB skips an env contributor that throws or times out and starts Claude anyway,
// so a thread on a named profile could silently run on the native login. Each
// Claude launch records a provider.env-resolved event; reviewing it lets the
// plugin stop a launch that lacks the selected profile.

/** The newest launch already reviewed, and a refusal still to show on the next send. */
export type Guard = { checkedSeq: number; notice: string | null };
export const initialGuard: Guard = { checkedSeq: 0, notice: null };

type EnvEntry = { name: string; value: string | { masked: true } };

/** Whether the launch received this profile's config directory. */
export function profileApplied(entries: readonly EnvEntry[], configDir: string) {
  const entry = entries.find(value => value.name === 'CLAUDE_CONFIG_DIR');
  return entry !== undefined && (entry.value === configDir || typeof entry.value !== 'string');
}

export function reviewLaunch(guard: Guard, launch: { seq: number; applied: boolean }, label: string) {
  if (launch.seq <= guard.checkedSeq) return { guard, stop: false };
  if (launch.applied) return { guard: { ...guard, checkedSeq: launch.seq }, stop: false };
  return { stop: true, guard: { checkedSeq: launch.seq, notice: `Claude started without the ${label} account, `
    + 'so Agent Switcher stopped the turn rather than run it on another login. Send your message again to retry. '
    + 'If this thread moved machine, choose its account again.' } };
}
