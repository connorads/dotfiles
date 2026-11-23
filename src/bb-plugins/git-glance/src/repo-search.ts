/**
 * Filters repository paths to those containing every query word, case-insensitively.
 * The first word ranks matches: exact name, name prefix, name substring, then path only.
 */
export function rankRepositories(paths: readonly string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...paths];
  const [first] = words;
  const score = (path: string) => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    return name === first ? 0 : name.startsWith(first) ? 1 : name.includes(first) ? 2 : 3;
  };
  return paths
    .map(path => ({ path, lower: path.toLowerCase() }))
    .filter(({ lower }) => words.every(word => lower.includes(word)))
    .map(({ path, lower }) => ({ path, rank: score(lower), depth: path.split('/').length }))
    .sort((a, b) => a.rank - b.rank || a.depth - b.depth || a.path.localeCompare(b.path))
    .map(({ path }) => path);
}

export function shortenPath(path: string, home: string): string {
  if (home && home !== '/' && path === home) return '~';
  if (home && home !== '/' && path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}

export function joinPath(parent: string, child: string): string {
  if (child.startsWith('/')) return child;
  if (!child || child === '.') return parent;
  return parent === '/' ? `/${child}` : `${parent}/${child}`;
}

export function breadcrumbs(root: string, home: string): { label: string; path: string }[] {
  if (home && home !== '/' && (root === home || root.startsWith(`${home}/`))) {
    const rest = root === home ? [] : root.slice(home.length + 1).split('/').filter(Boolean);
    return [{ label: '~', path: home }, ...rest.map((label, index) => ({ label, path: `${home}/${rest.slice(0, index + 1).join('/')}` }))];
  }
  const parts = root.split('/').filter(Boolean);
  return [{ label: '/', path: '/' }, ...parts.map((label, index) => ({ label, path: `/${parts.slice(0, index + 1).join('/')}` }))];
}

export function isDirectPath(query: string): boolean {
  const trimmed = query.trim();
  return trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('/');
}

export type HostCandidate = { path: string; label?: string; source: 'dotfiles' | 'recent' | 'project' };
const sourceOrder: Record<HostCandidate['source'], number> = { dotfiles: 0, recent: 1, project: 2 };

export function rankHostRepos(candidates: readonly HostCandidate[], query: string, home: string): HostCandidate[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...candidates];
  const [first] = words;
  const scoreWord = (text: string) =>
    text === first ? 0 : text.startsWith(first) ? 1 : text.includes(first) ? 2 : 3;
  return candidates
    .map(candidate => {
      const display = shortenPath(candidate.path, home);
      const base = candidate.path.slice(candidate.path.lastIndexOf('/') + 1).toLowerCase();
      const label = (candidate.label ?? base).toLowerCase();
      const haystack = `${candidate.label ?? ''} ${display} ${candidate.path}`.toLowerCase();
      return { candidate, display, haystack, rank: Math.min(scoreWord(label), scoreWord(base)) };
    })
    .filter(({ haystack }) => words.every(word => haystack.includes(word)))
    .sort((a, b) => a.rank - b.rank || sourceOrder[a.candidate.source] - sourceOrder[b.candidate.source]
      || a.display.length - b.display.length || a.display.localeCompare(b.display))
    .map(({ candidate }) => candidate);
}
