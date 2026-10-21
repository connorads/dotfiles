import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { experimental_copyToClipboard, experimental_Icon as Icon, useRealtimeConnectionState } from '@get-bb/plugin-sdk/app';
import type { OpRequest, Repo } from './contracts.ts';
import { CommitComposer } from './commit-composer.tsx';
import { BranchPicker } from './branch-picker.tsx';
import { CommitList, CommitPanel } from './commits.tsx';
import type { RepoState } from './repo-store.ts';
import { ChangeRow, DiffPane } from './rows.tsx';
import { StashList } from './stash-list.tsx';
import { age, freshKeys, plural } from './src/format.ts';
import { describe, hints, SyncBar } from './sync-bar.tsx';
import { changeKey, CopyIcon, DiffBar, Fact, HoldButton, useNow, Zoomed } from './ui.tsx';

const sections = [
  { area: 'conflicted', label: 'Conflicts', icon: 'DiffConflict' },
  { area: 'staged', label: 'Staged', icon: 'CircleCheck' },
  { area: 'unstaged', label: 'Changes', icon: 'DiffModified' },
  { area: 'untracked', label: 'Untracked', icon: 'DiffAdded' },
] as const;
const operationNames: Record<NonNullable<Repo['operation']>, string> = {
  bisect: 'Bisect', 'cherry-pick': 'Cherry-pick', merge: 'Merge', rebase: 'Rebase', revert: 'Revert',
};

type Selection = { kind: 'file'; key: string } | { kind: 'commit'; sha: string } | { kind: 'stash'; sha: string };

export function RepoView({ repo, threadId, state, actionError, dismissed, onDismiss, onRun, onCancel, picker, onPicker, onZoom, onClose, onFolders }: {
  repo: Repo; threadId: string; state: RepoState; actionError: string | null;
  dismissed: string | null; onDismiss: (id: string) => void; onRun: (request: OpRequest) => Promise<boolean>; onCancel: () => void;
  picker: 'closed' | 'pointer' | 'keyboard'; onPicker: (state: 'closed' | 'pointer' | 'keyboard') => void;
  onFolders: () => void; onZoom: () => void; onClose: () => void;
}) {
  const zoomed = useContext(Zoomed);
  const now = useNow(1000);
  const connection = useRealtimeConnectionState();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  // The zoomed view's detail pane: one file, commit or stash at a time.
  const pendingFile = useRef<{ path: string; staged: boolean; before: Repo['changes']; focus: boolean } | null>(null);
  useEffect(() => {
    const pending = pendingFile.current;
    if (!pending || pending.before === repo.changes) return;
    const file = repo.changes.find(c => c.path === pending.path && (pending.staged ? c.area === 'staged' : c.area !== 'staged'));
    if (!file) return;
    pendingFile.current = null;
    setSelection({ kind: 'file', key: changeKey(file) });
    setExpanded(changeKey(file));
    setCollapsed(previous => { const next = new Set(previous); next.delete(file.area); return next; });
    if (pending.focus) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-file-path="${CSS.escape(file.path)}"][data-file-area="${file.area}"]`)?.focus());
  }, [repo.changes]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectedFile = selection?.kind === 'file' ? repo.changes.find(change => changeKey(change) === selection.key) ?? repo.changes.find(change => change.path === selection.key.slice(selection.key.indexOf(':') + 1)) ?? null : null;
  useEffect(() => {
    if (!zoomed) return;
    // Keep the pane useful: a file that stops being changed hands over to the next one.
    if (selection && (selection.kind !== 'file' || selectedFile)) return;
    const first = repo.changes[0];
    setSelection(first ? { kind: 'file', key: changeKey(first) } : repo.commits[0] ? { kind: 'commit', sha: repo.commits[0].sha } : null);
  }, [zoomed, selection, selectedFile, repo.changes, repo.commits]);
  const [copied, setCopied] = useState<string | null>(null);
  const toggle = (key: string) => setCollapsed(previous => {
    const next = new Set(previous);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const copy = (sha: string) => {
    void experimental_copyToClipboard({ text: sha }).then(ok => {
      if (!ok) return;
      setCopied(sha);
      setTimeout(() => setCopied(c => c === sha ? null : c), 1400);
    });
  };
  const { branch } = repo;
  const totals = repo.changes.reduce((sum, c) => ({ added: sum.added + (c.added ?? 0), removed: sum.removed + (c.removed ?? 0) }), { added: 0, removed: 0 });
  const files = new Set(repo.changes.map(c => c.path)).size + repo.hidden;
  const conflicts = repo.changes.some(c => c.area === 'conflicted');
  const tone = repo.operation || conflicts ? 'danger' : files > 0 ? 'dirty' : 'clean';
  const { op } = state;
  /** Unstaged edits and untracked paths can be discarded; staged and conflicted cannot. */
  const discardAction = (change: Repo['changes'][number]) => {
    const { area, path } = change;
    if (area !== 'unstaged' && area !== 'untracked') return null;
    return <HoldButton icon="Trash2" label="Discard" confirmLabel="Press again to discard" disabled={op?.status === 'running'}
      onConfirm={() => onRun({ kind: 'discard', path, area })} />;
  };
  const indexAction = (change: Repo['changes'][number]) => change.area === 'conflicted' || change.path.endsWith('/') ? null :
    <button type="button" className="gg-ghost gg-index-action" disabled={op?.status === 'running'}
      aria-label={`${change.area === 'staged' ? 'Unstage' : 'Stage'} ${change.path}`} title={`${change.area === 'staged' ? 'Unstage' : 'Stage complete file'} ${change.path} (s)`}
      onClick={() => {
        pendingFile.current = { path: change.path, staged: change.area !== 'staged', before: repo.changes, focus: document.activeElement?.closest('.gg-change') !== null };
        if (change.area === 'staged') void onRun({ kind: 'unstage', path: change.path });
        else if (change.area === 'unstaged' || change.area === 'untracked') void onRun({ kind: 'stage', path: change.path, area: change.area });
      }}>{change.area === 'staged' ? '− Unstage' : '+ Stage'}</button>;
  const running = op?.status === 'running' ? op : null;
  const fetched = state.fetch.lastSucceededAt !== null ? age(state.fetch.lastSucceededAt / 1000, now) : null;
  const fetchError = state.fetchRequestError ?? state.fetch.failure?.message ?? null;
  // A user's failure stays until dismissed; a success fades after a few seconds.
  const failure = op?.status === 'failed' && op.origin === 'user' && op.request.kind !== 'fetch' && dismissed !== op.id ? op : null;
  const success = op?.status === 'succeeded' && op.origin === 'user' && now - op.finishedAt < 6000 ? op : null;
  const fresh = useFresh(repo);

  return <>
    <header className="gg-header" data-tone={tone}>
      <div className="gg-eyebrow">
        <Icon name={repo.kind === 'dotfiles' ? 'Home' : 'FolderGit'} className="size-3.5" />
        <button type="button" className="gg-ghost" disabled={state.op?.status === 'running'} onClick={onFolders} title="Change repository">{repo.name}<Icon name="ChevronDown" className="size-3" /></button>
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
      <p className="gg-folder-path" title={state.root ?? undefined}>{state.root}</p>
      <div className="gg-title">
        <Icon name={branch.head ? 'GitBranch' : 'Circle'} className="gg-title-icon" />
        <button type="button" className="gg-branch" aria-haspopup="dialog" aria-expanded={picker !== 'closed'}
          onClick={event => onPicker(picker !== 'closed' ? 'closed' : event.detail === 0 ? 'keyboard' : 'pointer')} title="Switch branch (b)">
          <h2>{branch.head ?? 'Detached HEAD'}</h2><Icon name="ChevronDown" className="gg-branch-chevron" />
        </button>
        {branch.upstream && <span className="gg-upstream"><Icon name="ArrowRight" className="size-3" />{branch.upstream}</span>}
        {picker !== 'closed' && <BranchPicker threadId={threadId} instant={picker === 'keyboard'} onSwitch={onRun} onClose={() => onPicker('closed')} />}
      </div>
      <div className="gg-facts">
        <SyncBar repo={repo} op={op} fetched={fetched} onSync={kind => onRun({ kind })} onCancel={onCancel} />
        {!branch.upstream && branch.head && repo.remotes.length > 0 && <Fact tone="quiet" icon="CloudOff" title="No upstream branch">Not published</Fact>}
        {branch.ahead > 0 && branch.behind > 0 && <Fact tone="behind" icon="AlertTriangle" title="Local and remote both have new commits">Diverged</Fact>}
        {repo.stashes.length > 0 && <Fact tone="quiet" icon="Archive" title="Stash entries">{plural(repo.stashes.length, 'stash')}</Fact>}
        {branch.oid && <button type="button" className="gg-fact gg-sha" data-tone="quiet" onClick={() => copy(branch.oid!)} title="Copy HEAD sha">
          <CopyIcon done={copied === branch.oid} />{copied === branch.oid ? 'Copied' : branch.oid.slice(0, 7)}
        </button>}
      </div>
      {fetchError && repo.remotes.length > 0 && <div className="gg-banner gg-failure" role="alert">
        <Icon name="AlertTriangle" className="size-4" />
        <div className="gg-failure-body">
          <strong>Couldn’t check the remote.</strong> Counts use cached remote data.
          {state.fetch.failure && <p>{hints[state.fetch.failure.reason]}</p>}
          <button type="button" className="gg-ghost" disabled={op?.status === 'running'} onClick={() => onRun({ kind: 'fetch' })}>Retry fetch</button>
          <details><summary>Error details</summary><pre>{fetchError}</pre></details>
        </div>
      </div>}
      {repo.operation && <div className="gg-banner" role="status"><Icon name="AlertTriangle" className="size-4" />
        <span><strong>{operationNames[repo.operation]} in progress.</strong> Resolve conflicts, then continue or abort in lazygit.</span></div>}
      {actionError && <div className="gg-banner" role="alert"><Icon name="CircleX" className="size-4" /><span>{actionError}</span></div>}
      {failure && <div className="gg-banner gg-failure" role="alert">
        <Icon name="CircleX" className="size-4" />
        <div className="gg-failure-body">
          <strong>{describe(failure.request).name} failed.</strong> {hints[failure.failure.reason] ?? ''}
          <pre>{failure.failure.message}</pre>
        </div>
        <button type="button" className="gg-ghost gg-icon-button" aria-label="Dismiss" onClick={() => onDismiss(failure.id)}><Icon name="X" className="size-3.5" /></button>
      </div>}
      {success && <div className="gg-success" role="status" data-leaving={now - success.finishedAt >= 5000 || undefined}><Icon name="CircleCheck" className="size-4" />{success.summary}</div>}
      {running?.request.kind === 'create-commit' && <div className="gg-banner" role="status">
        <span>Running commit hooks and signing…</span><button type="button" className="gg-ghost" onClick={onCancel}>Cancel commit</button>
      </div>}
      {running && <div className="gg-progress" role="progressbar" aria-label={`${describe(running.request).name} progress`}
        aria-valuenow={running.progress?.percent ?? undefined} data-indeterminate={running.progress?.percent == null || undefined}>
        <i style={running.progress?.percent != null ? { '--gg-progress': running.progress.percent / 100 } as React.CSSProperties : undefined} />
      </div>}
    </header>

    <div className="gg-body" data-split={zoomed || undefined}>
      <div className="gg-list">
      <CommitComposer threadId={threadId} repository={state.root ?? repo.name} branch={branch.head ?? 'Detached HEAD'} op={op} onRun={onRun} onCancel={onCancel} />
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
              action={<>{indexAction(change)}{discardAction(change)}</>}
              inline={!zoomed}
              open={zoomed ? selection?.kind === 'file' && selection.key === changeKey(change) : expanded === changeKey(change)}
              onToggle={zoomed ? () => setSelection({ kind: 'file', key: changeKey(change) })
                : () => setExpanded(e => e === changeKey(change) ? null : changeKey(change))} />)}</ul>}
          </section>;
        })}
        {repo.hidden > 0 && <p className="gg-note">{plural(repo.hidden, 'more change')} not shown. Open lazygit for the full list.</p>}
      </>}

      {repo.stashes.length > 0 && <section className="gg-section gg-stashes">
        <button type="button" data-row className="gg-section-head" aria-expanded={!collapsed.has('stashes')} onClick={() => toggle('stashes')}>
          <Icon name="ChevronRight" className="gg-chevron" />
          <Icon name="Archive" className="gg-section-icon" />
          Stashes<span className="gg-count">{repo.stashes.length}</span>
        </button>
        {!collapsed.has('stashes') && <StashList stashes={repo.stashes} threadId={threadId} now={now} op={op} copied={copied} onCopy={copy} onRun={onRun}
          {...zoomed ? { selected: selection?.kind === 'stash' ? selection.sha : null, onSelect: (sha: string) => setSelection({ kind: 'stash', sha }) } : {}} />}
      </section>}

      {repo.commits.length > 0 && <section className="gg-section gg-commits">
        <button type="button" data-row className="gg-section-head" aria-expanded={!collapsed.has('commits')} onClick={() => toggle('commits')}>
          <Icon name="ChevronRight" className="gg-chevron" />
          <Icon name="Clock" className="gg-section-icon" />
          Commits<span className="gg-count">{repo.commits.length}</span>
        </button>
        {!collapsed.has('commits') && <CommitList commits={repo.commits} threadId={threadId} now={now} copied={copied} onCopy={copy} fresh={fresh.commits} stamp={fresh.stamp}
          {...zoomed ? { selected: selection?.kind === 'commit' ? selection.sha : null, onSelect: (sha: string) => setSelection({ kind: 'commit', sha }) } : {}} />}
      </section>}
      </div>
      {zoomed && <aside className="gg-detail" aria-label="Details">
        {selection?.kind === 'file' && selectedFile ? <>
          <div className="gg-detail-head">
            <span className="gg-code" data-code={selectedFile.code}>{selectedFile.code === '?' ? 'U' : selectedFile.code === 'U' ? '!' : selectedFile.code}</span>
            {indexAction(selectedFile)}
            <span className="gg-detail-path">{selectedFile.origPath ? `${selectedFile.origPath} → ` : ''}{selectedFile.path}</span>
          </div>
          {selectedFile.path.endsWith('/')
            ? <p className="gg-note">An untracked folder. Its files appear once one of them is added.</p>
            : <DiffPane file={selectedFile} source={{ kind: 'work-tree', area: selectedFile.area }} threadId={threadId} fill />}
        </> : selection && selection.kind !== 'file'
          ? <CommitPanel key={selection.sha} sha={selection.sha} threadId={threadId} now={now} copied={copied} onCopy={copy} lanes={[]} width={0} stash={selection.kind === 'stash'} />
          : <p className="gg-note gg-detail-empty">Select a file, stash or commit.</p>}
      </aside>}
    </div>

    <footer className="gg-footer">
      <span className="gg-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> diff <kbd>s</kbd> stage/unstage <kbd>d</kbd> discard twice <kbd>p</kbd> pull <kbd>⇧P</kbd> push <kbd>f</kbd> fetch <kbd>b</kbd> branch <kbd>z</kbd> {zoomed ? 'shrink' : 'expand'} <kbd>l</kbd> lazygit <kbd>q</kbd> close</span>
      <span className="gg-live" data-state={state.error || fetchError || connection !== 'connected' ? 'error' : running ? 'loading' : 'live'}
        title={state.error ?? fetchError ?? 'Watches local files and refs. Fetch checks the remote.'}>
        <span className="gg-live-dot" key={state.updatedAt ?? 0} />
        {state.error ? 'Out of date' : connection !== 'connected' ? 'Reconnecting…'
          : fetchError ? 'Fetch failed' : running ? `${describe(running.request).doing}…` : 'Watching files'}
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
