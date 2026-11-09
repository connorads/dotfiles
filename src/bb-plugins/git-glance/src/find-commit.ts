import { access, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveRepo, run } from './repo.ts';
import type { CommitLookup } from '../contracts.ts';

/** Search Git's existing objects, only on demand, with four bounded workers. */
export async function findCommit(roots: string[], sha: string, signal?: AbortSignal): Promise<CommitLookup> {
  const deadline = AbortSignal.any([AbortSignal.timeout(5000), ...signal ? [signal] : []]);
  const results: (CommitLookup['matches'][number] | null)[] = Array.from({ length: roots.length }, () => null);
  const seen = new Set<string>();
  let next = 0; let unchecked = 0;
  async function worker() {
    while (next < roots.length) {
      const index = next++;
      if (deadline.aborted) { unchecked++; continue; }
      const check = AbortSignal.any([deadline, AbortSignal.timeout(2000)]);
      try {
        const path = await realpath(roots[index]);
        if (seen.has(path)) continue;
        const repo = await resolveRepo(path, undefined, check);
        check.throwIfAborted();
        if (!repo) {
          // BB projects can be ordinary folders. A broken Git directory is incomplete coverage.
          if (await access(join(path, '.git')).then(() => true, cause => cause.code !== 'ENOENT')) unchecked++;
          continue;
        }
        const root = await realpath(repo.cwd);
        if (seen.has(root)) continue;
        seen.add(root);
        const result = await run(repo.cwd, [...repo.select, 'rev-parse', '--verify', '--quiet', `${sha}^{commit}`], [0, 1], check);
        if (result.code === 0) results[index] = { root, sha: result.stdout.trim() };
        else if (result.stderr.includes('ambiguous')) unchecked++;
      } catch { unchecked++; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, roots.length) }, worker));
  return { matches: results.filter(value => value !== null), unchecked };
}
