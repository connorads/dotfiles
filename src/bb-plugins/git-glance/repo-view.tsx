import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { experimental_Icon as Icon, useRealtimeConnectionState } from '@get-bb/plugin-sdk/app';
import type { OpKind, Repo } from './contracts.ts';
import { CommitList } from './commits.tsx';
import type { RepoState } from './repo-store.ts';
import { ChangeRow } from './rows.tsx';
import { age, freshKeys, plural } from './src/format.ts';
import { hints, opNames, SyncBar } from './sync-bar.tsx';
import { changeKey, CopyIcon, DiffBar, Fact, useNow, Zoomed } from './ui.tsx';

const sections = [
  { area: 'conflicted', label: 'Conflicts', icon: 'DiffConflict' },
  { area: 'staged', label: 'Staged', icon: 'CircleCheck' },
  { area: 'unstaged', label: 'Changes', icon: 'DiffModified' },
  { area: 'untracked', label: 'Untracked', icon: 'DiffAdded' },
] as const;
const operationNames: Record<NonNullable<Repo['operation']>, string> = {
  bisect: 'Bisect', 'cherry-pick': 'Cherry-pick', merge: 'Merge', rebase: 'Rebase', revert: 'Revert',
};

export function RepoView({ repo, threadId, state, actionError, dismissed, onDismiss, onSync, onCancel, onZoom, onClose }: {
  repo: Repo; threadId: string; state: RepoState; actionError: string | null;
  dismissed: string | null; onDismiss: (id: string) => void; onSync: (op: OpKind) => void; onCancel: () => void;
  onZoom: () => void; onClose: () => void;
}) {
  const zoomed = useContext(Zoomed);
  const now = useNow(1000);
  const connection = useRealtimeConnectionState();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const toggle = (key: string) => setCollapsed(previous => {
    const next = new Set(previous);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const copy = (sha: string) => {
    void navigator.clipboard.writeText(sha).then(() => { setCopied(sha); setTimeout(() => setCopied(c => c === sha ? null : c), 1400); });
  };
  const { branch } = repo;
  const totals = repo.changes.reduce((sum, c) => ({ added: sum.added + (c.added ?? 0), removed: sum.removed + (c.removed ?? 0) }), { added: 0, removed: 0 });
  const files = new Set(repo.changes.map(c => c.path)).size + repo.hidden;
  const conflicts = repo.changes.some(c => c.area === 'conflicted');
  const tone = repo.operation || conflicts ? 'danger' : files > 0 ? 'dirty' : 'clean';
  const { op } = state;
  const running = op?.status === 'running' ? op : null;
  const fetched = repo.fetchedAt ? age(repo.fetchedAt / 1000, now) : null;
  // A user's failure stays until dismissed; a success fades after a few seconds.
  const failure = op?.status === 'failed' && op.origin === 'user' && dismissed !== op.id ? op : null;
  const success = op?.status === 'succeeded' && op.origin === 'user' && now - op.finishedAt < 6000 ? op : null;
  const fresh = useFresh(repo);
  const autoFailed = op?.status === 'failed' && op.origin === 'auto' ? op : null;

  return <>
    <header className="gg-header" data-tone={tone}>
      <div className="gg-eyebrow">
        <Icon name={repo.kind === 'dotfiles' ? 'Home' : 'FolderGit'} className="size-3.5" />
        <span>{repo.name}</span>
        {repo.kind === 'dotfiles' && <span className="gg-tag">bare repo</span>}
        <span className="gg-spacer" />
        <button type="button" className="gg-ghost gg-icon-button" onClick={onZoom} aria-pressed={zoomed}
          aria-label={zoomed ? 'Shrink to pop-up' : 'Expand'} title={zoomed ? 'Shrink to pop-up (z)' : 'Expand (z)'}>
          <span className="gg-swap" data-done={zoomed || undefined} aria-hidden>
            <Icon name="Maximize2" className="size-3.5" /><Icon name="Minimize2" className="size-3.5" />
          </span>
        </button>
        <button type="button" className="gg-ghost gg-icon-button" onClick={onClose} aria-label="Close" title="Close (q or esc)">
          <Icon name="X" className="size-3.5" />
        </button>
      </div>
      <div className="gg-title">
        <Icon name={branch.head ? 'GitBranch' : 'Circle'} className="gg-title-icon" />
        <h2>{branch.head ?? 'Detached HEAD'}</h2>
        {branch.upstream && <span className="gg-upstream"><Icon name="ArrowRight" className="size-3" />{branch.upstream}</span>}
      </div>
      <div className="gg-facts">
        <SyncBar repo={repo} op={op} fetched={fetched} onSync={onSync} onCancel={onCancel} />
        {!branch.upstream && branch.head && repo.remotes.length > 0 && <Fact tone="quiet" icon="CloudOff" title="No upstream branch">Not published</Fact>}
        {branch.ahead > 0 && branch.behind > 0 && <Fact tone="behind" icon="AlertTriangle" title="Local and remote both have new commits">Diverged</Fact>}
        {repo.stash > 0 && <Fact tone="quiet" icon="Archive" title="Stash entries">{plural(repo.stash, 'stash')}</Fact>}
        {branch.oid && <button type="button" className="gg-fact gg-sha" data-tone="quiet" onClick={() => copy(branch.oid!)} title="Copy HEAD sha">
          <CopyIcon done={copied === branch.oid} />{copied === branch.oid ? 'Copied' : branch.oid.slice(0, 7)}
        </button>}
      </div>
      {repo.operation && <div className="gg-banner" role="status"><Icon name="AlertTriangle" className="size-4" />
        <span><strong>{operationNames[repo.operation]} in progress.</strong> Resolve conflicts, then continue or abort in lazygit.</span></div>}
      {actionError && <div className="gg-banner" role="alert"><Icon name="CircleX" className="size-4" /><span>{actionError}</span></div>}
      {failure && <div className="gg-banner gg-failure" role="alert">
        <Icon name="CircleX" className="size-4" />
        <div className="gg-failure-body">
          <strong>{opNames[failure.kind]} failed.</strong> {hints[failure.failure.reason] ?? ''}
          <pre>{failure.failure.message}</pre>
        </div>
        <button type="button" className="gg-ghost gg-icon-button" aria-label="Dismiss" onClick={() => onDismiss(failure.id)}><Icon name="X" className="size-3.5" /></button>
      </div>}
      {success && <div className="gg-success" role="status" data-leaving={now - success.finishedAt >= 5000 || undefined}><Icon name="CircleCheck" className="size-4" />{success.summary}</div>}
      {running && <div className="gg-progress" role="progressbar" aria-label={`${opNames[running.kind]} progress`}
        aria-valuenow={running.progress?.percent ?? undefined} data-indeterminate={running.progress?.percent == null || undefined}>
        <i style={running.progress?.percent != null ? { '--gg-progress': running.progress.percent / 100 } as React.CSSProperties : undefined} />
      </div>}
    </header>

    <div className="gg-body">
      {files === 0 ? <div className="gg-clean">
        <span className="gg-clean-mark"><Icon name="Check" className="size-4" /></span>
        <div><strong>Working tree clean</strong><span>Nothing to commit{branch.head ? ` on ${branch.head}` : ''}.</span></div>
      </div> : <>
        <div className="gg-summary">
          <span><strong>{plural(files, 'file')}</strong> changed</span>
          {(totals.added > 0 || totals.removed > 0) && <span className="gg-stat"><span className="gg-add">+{totals.added}</span><span className="gg-del">−{totals.removed}</span></span>}
          <DiffBar added={totals.added} removed={totals.removed} />
        </div>
        {sections.map(section => {
          const items = repo.changes.filter(c => c.area === section.area);
          if (items.length === 0) return null;
          const closed = collapsed.has(section.area);
          return <section key={section.area} className="gg-section" data-area={section.area}>
            <button type="button" data-row className="gg-section-head" aria-expanded={!closed} onClick={() => toggle(section.area)}>
              <Icon name="ChevronRight" className="gg-chevron" />
              <Icon name={section.icon} className="gg-section-icon" />
              {section.label}<span className="gg-count">{items.length}</span>
            </button>
            {!closed && <ul>{items.map(change => <ChangeRow key={changeKey(change)} file={change} source={{ kind: 'work-tree', area: change.area }} threadId={threadId}
              flash={fresh.changes.has(changeKey(change)) ? fresh.stamp : null}
              open={expanded === changeKey(change)} onToggle={() => setExpanded(e => e === changeKey(change) ? null : changeKey(change))} />)}</ul>}
          </section>;
        })}
        {repo.hidden > 0 && <p className="gg-note">{plural(repo.hidden, 'more change')} not shown. Open lazygit for the full list.</p>}
      </>}

      {repo.commits.length > 0 && <section className="gg-section gg-commits">
        <button type="button" data-row className="gg-section-head" aria-expanded={!collapsed.has('commits')} onClick={() => toggle('commits')}>
          <Icon name="ChevronRight" className="gg-chevron" />
          <Icon name="Clock" className="gg-section-icon" />
          Commits<span className="gg-count">{repo.commits.length}</span>
        </button>
        {!collapsed.has('commits') && <CommitList commits={repo.commits} threadId={threadId} now={now} copied={copied} onCopy={copy} fresh={fresh.commits} stamp={fresh.stamp} />}
      </section>}
    </div>

    <footer className="gg-footer">
      <span className="gg-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> diff <kbd>p</kbd> pull <kbd>⇧P</kbd> push <kbd>f</kbd> fetch <kbd>z</kbd> {zoomed ? 'shrink' : 'expand'} <kbd>q</kbd> close</span>
      <span className="gg-live" data-state={state.error || connection !== 'connected' ? 'error' : running ? 'loading' : 'live'}
        title={state.error ?? autoFailed?.failure.message ?? 'Updates when files or refs change'}>
        <span className="gg-live-dot" key={state.updatedAt ?? 0} />
        {state.error ? 'Out of date' : connection !== 'connected' ? 'Reconnecting…'
          : autoFailed ? 'Fetch failed' : running ? `${opNames[running.kind]}ing…` : 'Live'}
      </span>
    </footer>
  </>;
}

/** Rows new or changed since the last snapshot, so live updates are visible as they land. */
function useFresh(repo: Repo) {
  const changes = new Map(repo.changes.map(change => [changeKey(change), `${change.code}:${change.added}/${change.removed}`]));
  const commits = new Map(repo.commits.map(commit => [commit.sha, '']));
  const stamp = JSON.stringify([...changes, ...commits]);
  const previous = useRef<{ changes: Map<string, string>; commits: Map<string, string> } | null>(null);
  // Compare in render, record after commit: render may run twice, so it must not mutate.
  const fresh = useMemo(() => ({
    changes: freshKeys(previous.current?.changes ?? null, changes),
    commits: freshKeys(previous.current?.commits ?? null, commits),
    stamp,
  }), [stamp]);
  useEffect(() => { previous.current = { changes, commits }; }, [stamp]);
  return fresh;
}
