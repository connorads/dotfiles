import { git, type Repo } from './repo.ts';
import { failed, spawnGit, type OpOptions, type OpResult } from './spawn.ts';

export type StashAction = 'apply' | 'pop' | 'drop';
const past: Record<StashAction, string> = { apply: 'Applied', pop: 'Popped', drop: 'Dropped' };

/**
 * Runs a stash action on the stash with this sha. The `stash@{n}` it needs is
 * looked up now, so a stash dropped or pushed since the list was shown can never
 * make the action hit a different stash.
 */
export async function stashAction(repo: Repo, action: StashAction, sha: string, options: OpOptions): Promise<OpResult> {
  const list = (await git(repo, ['stash', 'list', '--format=%H%x1f%gs'])).split('\n').filter(Boolean).map(line => line.split('\x1f'));
  const index = list.findIndex(([entry]) => entry === sha);
  if (index < 0) return { ok: false, failure: { reason: 'unknown', message: 'That stash no longer exists.' } };
  const subject = list[index]![1] ?? '';
  const result = await spawnGit(repo, ['stash', action, `stash@{${index}}`], options);
  if (result.code !== 0) return failed(result, `stash ${action}`, options.timeoutMs);
  return { ok: true, summary: `${past[action]} “${subject.replace(/^(On|WIP on) [^:]+: /, '')}”` };
}
