/** Compact age: "now", "42s", "5m", "3h", "6d", then a date. */
export function age(unixSeconds: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round(now / 1000 - unixSeconds));
  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  const date = new Date(unixSeconds * 1000);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: '2-digit' }) });
}

export type Block = 'added' | 'removed' | 'neutral';
/** GitHub-style five-block diffstat; any change shows at least one coloured block. */
export function diffBlocks(added: number, removed: number, blocks = 5): Block[] {
  const total = added + removed;
  if (total === 0) return Array<Block>(blocks).fill('neutral');
  const filled = Math.min(blocks, Math.max(1, Math.ceil(Math.log10(total + 1) * 2)));
  let green = Math.round(filled * added / total);
  if (added > 0 && green === 0) green = 1;
  if (removed > 0 && green === filled) green = filled - 1;
  return [...Array<Block>(green).fill('added'), ...Array<Block>(filled - green).fill('removed'), ...Array<Block>(blocks - filled).fill('neutral')];
}

export function splitPath(path: string): { dir: string; name: string } {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const slash = trimmed.lastIndexOf('/');
  return slash < 0 ? { dir: '', name: path } : { dir: trimmed.slice(0, slash + 1), name: path.slice(slash + 1) };
}

export function plural(count: number, word: string) { return `${count} ${word}${count === 1 ? '' : 's'}`; }

/**
 * Keys whose value is new or different since the previous render, for a one-off
 * highlight. The first render has no previous state, so nothing is fresh.
 */
export function freshKeys(previous: ReadonlyMap<string, string> | null, next: ReadonlyMap<string, string>): Set<string> {
  if (!previous) return new Set();
  return new Set([...next].filter(([key, value]) => previous.get(key) !== value).map(([key]) => key));
}
