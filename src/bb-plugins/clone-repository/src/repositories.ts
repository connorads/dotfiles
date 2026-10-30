export function parseRepository(input: string): string | null {
  let value = input.trim();
  if (value.length > 300 || value.includes('%') || /(?:^|\/)\.{1,2}(?:\/|$)/u.test(value)) return null;
  if (/^git@github\.com:/iu.test(value)) value = value.slice('git@github.com:'.length);
  else if (value.includes('://')) {
    try {
      const url = new URL(value);
      if (url.hostname.toLowerCase() !== 'github.com' || url.port || url.search || url.hash) return null;
      if (url.protocol === 'https:') {
        if (url.username || url.password) return null;
      } else if (url.protocol !== 'ssh:' || url.username !== 'git' || url.password) return null;
      value = url.pathname.slice(1);
    } catch { return null; }
  }
  value = value.replace(/\/$/u, '').replace(/\.git$/u, '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.][a-zA-Z0-9_.-]*$/u.test(value)) return null;
  const name = value.split('/')[1];
  if (name === '.' || name === '..') return null;
  return value.toLowerCase();
}
