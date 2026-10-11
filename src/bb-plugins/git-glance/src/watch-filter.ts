// Which filesystem changes can alter what the pop-up shows. git writes `<file>.lock`
// then renames it into place (lockfile.h), so only the final path matters.

/** Git-dir entries a refresh never depends on; passed to the native watcher. */
export const gitDirIgnores = [
  'objects', 'logs', 'hooks', 'info', 'lfs', 'modules', 'fsmonitor--daemon', 'worktrees',
  '**/*.lock', 'COMMIT_EDITMSG', 'MERGE_MSG', 'SQUASH_MSG', 'MERGE_MODE', 'gc.pid', 'gc.log', 'description',
];

/** Second check for paths relative to a git dir, in case the watcher passes one through. */
export function gitDirRelevant(path: string): boolean {
  if (!path || path.endsWith('.lock')) return false;
  const [top] = path.split('/');
  return !gitDirIgnores.includes(top!) && !gitDirIgnores.includes(path);
}

/** Root-relative path of `path` under `root`, or null when outside it. */
export function within(root: string, path: string): string | null {
  if (path === root) return '';
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}
