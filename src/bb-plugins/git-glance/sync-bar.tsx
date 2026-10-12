import { experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import type { FailureReason, OpKind, OpRequest, OpState, Repo } from './contracts.ts';
import { plural } from './src/format.ts';

/** Labels for an operation: what it is, and what it is doing while it runs. */
export function describe(request: OpRequest): { name: string; doing: string } {
  switch (request.kind) {
    case 'fetch': return { name: 'Fetch', doing: 'Fetching' };
    case 'pull': return { name: 'Pull', doing: 'Pulling' };
    case 'push': return { name: 'Push', doing: 'Pushing' };
    case 'switch': return { name: `Switch to ${request.track ? request.branch.slice(request.branch.indexOf('/') + 1) : request.branch}`, doing: 'Switching' };
    case 'stash-apply': return { name: 'Apply stash', doing: 'Applying' };
    case 'stash-pop': return { name: 'Pop stash', doing: 'Popping' };
    case 'stash-drop': return { name: 'Drop stash', doing: 'Dropping' };
    case 'discard': return { name: `Discard ${request.path.replace(/\/$/, '').split('/').pop()}`, doing: 'Discarding' };
  }
}
export const hints: Record<FailureReason, string | null> = {
  rejected: 'The remote has commits you do not have. Pull first, then push.',
  diverged: 'Local and remote both have new commits. Rebase or merge in lazygit.',
  dirty: 'Local changes would be overwritten. Commit or stash them first.',
  conflict: 'Stopped on conflicts. Resolve them in lazygit.',
  auth: 'Git could not sign in without a prompt. Run the command once in a terminal to authenticate.',
  network: 'Could not reach the remote. Check the connection and try again.',
  locked: 'Another git process is busy here. Try again in a moment.',
  'no-remote': null, timeout: null, cancelled: null, unknown: null,
};

export type Availability = Record<OpKind, { enabled: boolean; title: string }>;
/** Which remote operations make sense now, and why not when they do not. */
export function available(repo: Repo, op: OpState | null): Availability {
  const { branch, remotes } = repo;
  const busy = op?.status === 'running' ? `${describe(op.request).name} is running.` : null;
  const none = remotes.length === 0 ? 'This repository has no remotes.' : null;
  const detached = branch.head ? null : 'HEAD is detached. Check out a branch first.';
  const diverged = branch.ahead > 0 && branch.behind > 0;
  const reason = {
    fetch: busy ?? none,
    pull: busy ?? none ?? detached ?? (!branch.upstream ? 'No upstream branch to pull from.'
      : diverged ? 'Local and remote have diverged. Rebase or merge in lazygit (⌘⇧G).' : branch.behind === 0 ? 'Nothing to pull. Fetch to check for new commits.' : null),
    push: busy ?? none ?? detached ?? (branch.upstream && branch.ahead === 0 ? 'Nothing to push.' : null),
  };
  const titles = {
    fetch: 'Fetch from the remote (f)',
    pull: `Pull ${plural(branch.behind, 'commit')} from ${branch.upstream} (p)`,
    push: branch.upstream ? `Push ${plural(branch.ahead, 'commit')} to ${branch.upstream} (⇧P)` : `Publish ${branch.head} to ${remotes.includes('origin') ? 'origin' : remotes[0]} (⇧P)`,
  };
  return Object.fromEntries((['fetch', 'pull', 'push'] as const).map(kind =>
    [kind, { enabled: reason[kind] === null, title: reason[kind] ?? titles[kind] }])) as Availability;
}

export function SyncBar({ repo, op, fetched, onSync, onCancel }: {
  repo: Repo; op: OpState | null; fetched: string | null; onSync: (op: OpKind) => void; onCancel: () => void;
}) {
  const can = available(repo, op);
  const running = op?.status === 'running' ? op : null;
  const { branch } = repo;
  const button = ({ kind, icon, label, count, tone }: { kind: OpKind; icon: string; label: string; count: number | null; tone: string }) => {
    const active = running?.request.kind === kind;
    return <button type="button" className="gg-sync" data-tone={tone} data-active={active || undefined}
      disabled={!can[kind].enabled && !active} title={active ? running?.progress?.phase ?? `${describe({ kind }).doing}…` : can[kind].title}
      onClick={() => active ? onCancel() : onSync(kind)} aria-label={active ? `Cancel ${kind}` : can[kind].title}>
      {active ? <span className="gg-spinner gg-spinner-sm" /> : <Icon name={icon} className="size-3.5" />}
      <span className="gg-sync-label">{active ? running?.progress?.percent != null ? `${running.progress.percent}%` : describe({ kind }).doing : label}</span>
      {!active && count !== null && count > 0 && <span className="gg-sync-count">{count}</span>}
      {active && <Icon name="X" className="gg-sync-cancel" />}
    </button>;
  };
  return <div className="gg-sync-bar" role="group" aria-label="Sync with remote">
    {button({ kind: 'pull', icon: 'ArrowDown', label: 'Pull', count: branch.upstream ? branch.behind : null, tone: branch.behind > 0 ? 'behind' : 'quiet' })}
    {button({ kind: 'push', icon: 'ArrowUp', label: branch.upstream || repo.remotes.length === 0 ? 'Push' : 'Publish',
      count: branch.upstream ? branch.ahead : null, tone: branch.ahead > 0 || (!branch.upstream && repo.remotes.length > 0) ? 'ahead' : 'quiet' })}
    {button({ kind: 'fetch', icon: 'ArrowReloadHorizontal', label: 'Fetch', count: null, tone: 'quiet' })}
    {fetched && !running && <span className="gg-fetched" title="Last fetch">{fetched === 'now' ? 'just now' : `${fetched} ago`}</span>}
  </div>;
}
