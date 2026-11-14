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
