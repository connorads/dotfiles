import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommitReview, OpRequest } from '../contracts.ts';
import { parseStatus } from './porcelain.ts';
import { git, operation, relative, type Repo } from './repo.ts';
import { failed, spawnGit, type OpOptions, type OpResult } from './spawn.ts';

const refuse = (message: string): OpResult => ({ ok: false, failure: { reason: 'unknown', message } });
const statusArgs = ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'];

/** Complete index review, independent of the display cap. Reads never refresh the index. */
export async function review(repo: Repo): Promise<CommitReview> {
  const status = parseStatus(await git(repo, statusArgs));
  const head = (await git(repo, ['rev-parse', '--verify', '-q', 'HEAD'], [0, 1])).trim() || null;
  // ls-files includes modes, object identities and conflict stages without writing a tree.
  const index = createHash('sha256').update(await git(repo, ['ls-files', '--stage', '-z'])).digest('hex');
  const count = (await git(repo, ['diff', '--cached', '--name-only', '-z'])).split('\0').filter(Boolean).length;
  const blocked = await operation(repo.gitDir) ? 'Finish the repository operation in a terminal.'
    : status.changes.some(c => c.area === 'conflicted') ? 'Resolve conflicts in a terminal.'
    : count === 0 ? 'No staged changes.' : null;
  return { head, index, count, blocked, draftKey: await realpath(repo.gitDir) };
}

/** Mutate only the selected file's index entries; working files remain untouched. */
export async function editIndex(repo: Repo, request: Extract<OpRequest, { kind: 'stage' | 'unstage' }>, options: OpOptions): Promise<OpResult> {
  const path = relative(request.path);
  if (path.endsWith('/') || path.split('/').some(p => p === '.' || p === '')) return refuse('Choose an individual file. Directory staging is unavailable.');
  const text = await git(repo, statusArgs);
  const status = parseStatus(text);
  const area = request.kind === 'unstage' ? 'staged' : request.area;
  const change = status.changes.find(c => c.path === path && c.area === area);
  if (!change || status.changes.some(c => c.path === path && c.area === 'conflicted')) return refuse('The file status changed. Refresh and select it again.');
  // Porcelain's submodule field is not retained by the display parser.
  if (text.split('\0').some(line => (line.startsWith('1 ') || line.startsWith('2 ')) && line.split(' ')[2]?.startsWith('S') && line.endsWith(` ${path}`))) return refuse('Manage submodules in a terminal.');
  if (area === 'unstaged' && repo.kind === 'dotfiles' && !(await git(repo, ['diff', '--name-only', '-z', '--', `:(literal)${path}`])).includes(`${path}\0`)) return refuse('This file has no filtered content changes.');
  const paths = change.origPath ? [relative(change.origPath), path] : [path];
  const literal = paths.map(p => `:(literal)${p}`);
  const born = (await git(repo, ['rev-parse', '--verify', '-q', 'HEAD'], [0, 1])).trim();
  const args = request.kind === 'stage' ? ['add', '--', ...literal]
    : born ? ['restore', '--staged', '--source=HEAD', '--', ...literal]
    : ['rm', '--cached', '-f', '--', ...literal];
  if (request.kind === 'stage') {
    for (const selected of paths) {
      const entry = await lstat(join(repo.cwd, selected)).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') return null;
        throw cause;
      });
      if (entry?.isDirectory()) return refuse('Choose an individual file. Directory staging is unavailable.');
    }
  }
  const result = await spawnGit(repo, args, options);
  return result.code === 0 && !result.aborted ? { ok: true, summary: `${request.kind === 'stage' ? 'Staged' : 'Unstaged'} ${path}` }
    : failed(result, request.kind, options.timeoutMs);
}

export async function createCommit(repo: Repo, request: Extract<OpRequest, { kind: 'create-commit' }>, options: OpOptions): Promise<OpResult> {
  if (!request.message.split('\n')[0]?.trim() || request.message.includes('\0')) return refuse('Enter a non-empty commit subject.');
  const current = await review(repo);
  if (current.blocked) return refuse(current.blocked);
  if (current.head !== request.head || current.index !== request.index) return refuse('HEAD or staged content changed. Review the index again before retrying.');
  options.onProgress({ phase: 'Running commit hooks and signing', percent: null });
  const result = await spawnGit(repo, ['commit', '--file=-'], { ...options, input: request.message });
  const after = await review(repo);
  if (result.code === 0 && !result.aborted) return { ok: true, summary: `Committed ${after.head?.slice(0, 7) ?? ''}` };
  if (after.head !== current.head) return refuse(`HEAD changed to ${after.head?.slice(0, 7)}. The commit may have completed. Review history before retrying.\n${result.output}`);
  const failure = failed(result, 'commit', options.timeoutMs);
  return failure.ok ? failure : { ...failure, failure: { ...failure.failure, message: result.aborted ? `${failure.failure.message}\n${result.output}` : failure.failure.message } };
}
