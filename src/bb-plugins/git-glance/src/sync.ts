import { parseStatus } from './porcelain.ts';
import { parsePushPorcelain, shortRef, type OpKind } from './remote.ts';
import { git, type Repo } from './repo.ts';
import { failed, spawnGit, type OpOptions, type OpResult, type Spawned } from './spawn.ts';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const count = async (repo: Repo, range: string[]) =>
  Number((await git(repo, ['rev-list', '--count', ...range]).catch(() => '0')).trim()) || 0;
const head = (repo: Repo) => git(repo, ['rev-parse', '--verify', '-q', 'HEAD'], [0, 1]).then(out => out.trim());

/** The remote `push -u` should publish to: `origin`, else the only remote. */
export function publishRemote(remotes: readonly string[]): string | null {
  return remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0]! : null;
}

export async function sync(repo: Repo, op: OpKind, options: OpOptions): Promise<OpResult> {
  const status = parseStatus(await git(repo, ['status', '--porcelain=v2', '--branch', '-z', '-uno']));
  const remotes = (await git(repo, ['remote'])).split('\n').filter(Boolean);
  if (remotes.length === 0) return { ok: false, failure: { reason: 'no-remote', message: 'This repository has no remotes.' } };
  const { branch } = status;
  const fail = (result: Spawned) => failed(result, op, options.timeoutMs);

  if (op === 'fetch') {
    const result = await spawnGit(repo, ['fetch', '--prune', '--progress'], options);
    if (result.code !== 0) return fail(result);
    if (!branch.upstream) return { ok: true, summary: 'Fetched' };
    const behind = await count(repo, ['HEAD..@{upstream}']);
    return { ok: true, summary: behind ? `${plural(behind, 'new commit')} on ${branch.upstream}` : `Up to date with ${branch.upstream}` };
  }

  if (op === 'pull') {
    if (!branch.head) return { ok: false, failure: { reason: 'unknown', message: 'HEAD is detached. Check out a branch to pull.' } };
    if (!branch.upstream) return { ok: false, failure: { reason: 'no-remote', message: `${branch.head} has no upstream branch to pull from.` } };
    const before = await head(repo);
    // --ff-only: a pop-up should never start a merge or rebase that can stop half way.
    const result = await spawnGit(repo, ['pull', '--ff-only', '--progress', '--no-edit'], options);
    if (result.code !== 0) return fail(result);
    const pulled = before ? await count(repo, [`${before}..HEAD`]) : 0;
    return { ok: true, summary: pulled ? `Pulled ${plural(pulled, 'commit')} from ${branch.upstream}` : `Already up to date with ${branch.upstream}` };
  }

  if (!branch.head) return { ok: false, failure: { reason: 'unknown', message: 'HEAD is detached. Check out a branch to push.' } };
  const remote = branch.upstream ? null : publishRemote(remotes);
  if (!branch.upstream && !remote) {
    return { ok: false, failure: { reason: 'no-remote', message: `Several remotes and no origin: choose one with git push -u <remote> ${branch.head}.` } };
  }
  const ahead = branch.upstream ? branch.ahead : await count(repo, ['HEAD', '--not', '--remotes']);
  const result = await spawnGit(repo, ['push', '--porcelain', '--progress', ...(remote ? ['-u', remote, 'HEAD'] : [])], options);
  const refs = parsePushPorcelain(result.stdout);
  if (result.code !== 0 || refs.some(ref => ref.flag === '!')) return fail(result);
  const target = remote ? `${remote}/${shortRef(refs[0]?.to ?? branch.head)}` : branch.upstream!;
  if (refs.every(ref => ref.flag === '=')) return { ok: true, summary: `${target} is already up to date` };
  return { ok: true, summary: remote ? `Published ${branch.head} to ${target}` : `Pushed ${plural(ahead, 'commit')} to ${target}` };
}
