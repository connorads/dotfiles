import type { Branch } from '../contracts.ts';
import { git, type Repo } from './repo.ts';
import { failed, spawnGit, type OpOptions, type OpResult } from './spawn.ts';

/** One ref per line, fields split by NUL: ref names cannot hold either. */
export const branchFormat = '%(refname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:unix)%00%(subject)';

function track(text: string) {
  return {
    ahead: Number(/ahead (\d+)/.exec(text)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(text)?.[1] ?? 0),
    gone: text === 'gone',
  };
}

/**
 * Local branches, then remote branches nothing local tracks yet: the current
 * branch first, then newest first. A remote branch with a local counterpart
 * would be a duplicate choice.
 */
export function parseBranches(output: string): Branch[] {
  const rows = output.split('\n').filter(Boolean).map(line => {
    const [ref = '', head, upstream, tracking = '', time, ...subject] = line.split('\0');
    const remote = ref.startsWith('refs/remotes/');
    return {
      name: ref.replace(/^refs\/(heads|remotes)\//, ''), kind: remote ? 'remote' as const : 'local' as const,
      current: head === '*', upstream: upstream || null, ...track(tracking),
      time: Number(time) || 0, subject: subject.join('\0'),
    };
  }).filter(branch => !(branch.kind === 'remote' && branch.name.endsWith('/HEAD')));
  const tracked = new Set(rows.flatMap(branch => branch.kind === 'local' && branch.upstream ? [branch.upstream] : []));
  const locals = new Set(rows.filter(branch => branch.kind === 'local').map(branch => branch.name));
  const newest = (a: Branch, b: Branch) => Number(b.current) - Number(a.current) || b.time - a.time || a.name.localeCompare(b.name);
  return [
    ...rows.filter(branch => branch.kind === 'local').sort(newest),
    ...rows.filter(branch => branch.kind === 'remote' && !tracked.has(branch.name)
      && !locals.has(branch.name.slice(branch.name.indexOf('/') + 1))).sort(newest),
  ];
}

export async function listBranches(repo: Repo): Promise<Branch[]> {
  return parseBranches(await git(repo, ['for-each-ref', `--format=${branchFormat}`, 'refs/heads', 'refs/remotes']));
}

/** Switch to a local branch, or create one tracking a remote branch. */
export async function switchBranch(repo: Repo, branch: string, trackRemote: boolean, options: OpOptions): Promise<OpResult> {
  const valid = await git(repo, ['check-ref-format', '--branch', branch], [0, 128]).catch(() => '');
  if (!valid.trim() || branch.startsWith('-')) return { ok: false, failure: { reason: 'unknown', message: `${branch} is not a branch name.` } };
  const result = await spawnGit(repo, trackRemote ? ['switch', '--track', branch] : ['switch', branch], options);
  if (result.code !== 0) return failed(result, 'switch', options.timeoutMs);
  const local = trackRemote ? branch.slice(branch.indexOf('/') + 1) : branch;
  return { ok: true, summary: trackRemote ? `Switched to ${local}, tracking ${branch}` : `Switched to ${local}` };
}
