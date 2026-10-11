import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { experimental_Diff as Diff, experimental_Icon as Icon, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { Change, Commit, CommitDetail, DiffSource, FailureReason, OpKind, OpState, Repo, rpcContract } from './contracts.ts';
import { GraphCell, graphWidth, laneColour, laneX } from './graph.tsx';
import { renew, useRepo, type RepoState } from './repo-store.ts';
import { age, diffBlocks, freshKeys, plural, splitPath } from './src/format.ts';
import { layoutGraph } from './src/graph.ts';

const popoverWidth = 640;
const margin = 12;
const sections = [
  { area: 'conflicted', label: 'Conflicts', icon: 'DiffConflict' },
  { area: 'staged', label: 'Staged', icon: 'CircleCheck' },
  { area: 'unstaged', label: 'Changes', icon: 'DiffModified' },
  { area: 'untracked', label: 'Untracked', icon: 'DiffAdded' },
] as const;
const codeNames: Record<Change['code'], string> = {
  A: 'Added', C: 'Copied', D: 'Deleted', M: 'Modified', R: 'Renamed', T: 'Type changed', U: 'Conflicted', '?': 'Untracked',
};
const operationNames: Record<NonNullable<Repo['operation']>, string> = {
  bisect: 'Bisect', 'cherry-pick': 'Cherry-pick', merge: 'Merge', rebase: 'Rebase', revert: 'Revert',
};
const opNames: Record<OpKind, string> = { fetch: 'Fetch', pull: 'Pull', push: 'Push' };
const hints: Record<FailureReason, string | null> = {
  rejected: 'The remote has commits you do not have. Pull first, then push.',
  diverged: 'Local and remote both have new commits. Rebase or merge in lazygit.',
  dirty: 'Local changes would be overwritten. Commit or stash them first.',
  conflict: 'The pull stopped on conflicts. Resolve them in lazygit.',
  auth: 'Git could not sign in without a prompt. Run the command once in a terminal to authenticate.',
  network: 'Could not reach the remote. Check the connection and try again.',
  locked: 'Another git process is busy here. Try again in a moment.',
  'no-remote': null, timeout: null, cancelled: null, unknown: null,
};
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const changeKey = (change: Change) => `${change.area}:${change.path}`;

export type Anchor = { top: number; right: number; bottom: number; left: number } | null;

const zoomedWidth = 1240;
const zoomKey = 'git-glance:zoomed';
/** Zoomed views have room for side-by-side diffs. */
const Zoomed = createContext(false);

function place(anchor: Anchor, zoomed: boolean) {
  if (zoomed) {
    const width = Math.min(zoomedWidth, window.innerWidth - margin * 4);
    return { width, top: Math.round(window.innerHeight * 0.04), left: (window.innerWidth - width) / 2, origin: 'top center' };
  }
  const width = Math.min(popoverWidth, window.innerWidth - margin * 2);
  if (!anchor) return { width, top: Math.round(window.innerHeight * 0.1), left: (window.innerWidth - width) / 2, origin: 'top center' };
  const left = Math.min(Math.max(margin, anchor.right - width), window.innerWidth - width - margin);
  return { width, top: anchor.bottom + 8, left, origin: `${anchor.right - left}px 0` };
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(id); }, [intervalMs]);
  return now;
}

export function GitPopover({ threadId, anchor, instant, onClose }: { threadId: string; anchor: Anchor; instant: boolean; onClose: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const state = useRepo(threadId, rpc);
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState(() => localStorage.getItem(zoomKey) === '1');
  // A click morphs between sizes; the z key switches at once, like opening by shortcut.
  const [morph, setMorph] = useState(false);
  const zoom = useCallback((via: 'pointer' | 'keyboard') => {
    setMorph(via === 'pointer');
    setZoomed(current => { localStorage.setItem(zoomKey, current ? '0' : '1'); return !current; });
  }, []);
  const [position, setPosition] = useState(() => place(anchor, zoomed));
  const [actionError, setActionError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    const resize = () => {
      const chip = document.querySelector(`[data-git-glance="${CSS.escape(threadId)}"]`)?.getBoundingClientRect();
      setPosition(place(chip ?? anchor, zoomed));
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [threadId, anchor, zoomed]);
  // Once data arrives: focus the first row for the arrow keys, and fetch so the
  // pull count is current. The server skips the fetch if one ran recently.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !state.snapshot) return;
    opened.current = true;
    dialog.current?.querySelector<HTMLElement>('[data-row]')?.focus({ preventScroll: true });
    if (state.snapshot.kind !== 'none' && state.snapshot.remotes.length > 0) {
      rpc.call('sync', { threadId, op: 'fetch', origin: 'auto' }).catch(() => {});
    }
  }, [state.snapshot, rpc, threadId]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const runOp = useCallback((op: OpKind) => {
    setActionError(null);
    rpc.call('sync', { threadId, op, origin: 'user' }).catch(cause => setActionError(message(cause)));
  }, [rpc, threadId]);
  const cancelOp = useCallback(() => { rpc.call('cancel', { threadId }).catch(cause => setActionError(message(cause))); }, [rpc, threadId]);


  function keyboard(event: React.KeyboardEvent<HTMLDialogElement>) {
    // Keep BB's global shortcuts from acting on keys meant for the pop-up.
    if (event.key !== 'Escape') event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const rows = Array.from(dialog.current?.querySelectorAll<HTMLElement>('[data-row]') ?? []);
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const move = (step: number) => {
      event.preventDefault();
      const next = rows[current < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, current + step))];
      next?.focus(); next?.scrollIntoView({ block: 'nearest' });
    };
    if (event.key === 'ArrowDown' || event.key === 'j') move(1);
    else if (event.key === 'ArrowUp' || event.key === 'k') move(-1);
    else if (event.key === 'r' || event.key === 'R') { event.preventDefault(); void renew(threadId); }
    else if (event.key === 'z') { event.preventDefault(); zoom('keyboard'); }
    else if (event.key === 'q') { event.preventDefault(); onClose(); }
    else if (repo && (event.key === 'P' || event.key === 'p' || event.key === 'f')) {
      const op = event.key === 'P' ? 'push' : event.key === 'p' ? 'pull' : 'fetch';
      event.preventDefault();
      if (available(repo, state.op)[op].enabled) runOp(op);
    }
  }

  const repo = state.snapshot?.kind === 'none' ? null : state.snapshot;
  return <dialog ref={dialog} className="gg-dialog" aria-label="Git status" onKeyDown={keyboard} data-instant={instant || undefined}
    data-zoomed={zoomed || undefined} data-morph={morph || undefined}
    style={{ top: position.top, left: position.left, width: position.width, transformOrigin: position.origin }}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onPointerDown={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    <div className="gg-panel">
      {repo ? <Zoomed.Provider value={zoomed}><RepoView repo={repo} threadId={threadId} state={state} actionError={actionError}
        dismissed={dismissed} onDismiss={setDismissed} onSync={runOp} onCancel={cancelOp}
        onZoom={() => zoom('pointer')} onClose={onClose} /></Zoomed.Provider>
        : <div className="gg-blank">
          {state.error ? <><Icon name="AlertTriangle" className="gg-blank-icon gg-danger" /><strong>Could not read git status</strong><span>{state.error}</span></>
            : state.snapshot?.kind === 'none' ? <><Icon name="FolderUnknown" className="gg-blank-icon" /><strong>Not a git repository</strong><span>This thread's checkout has no repository.</span></>
            : <><span className="gg-spinner" /><span>Reading repository…</span></>}
        </div>}
    </div>
  </dialog>;
}

type Availability = Record<OpKind, { enabled: boolean; title: string }>;
/** Which remote operations make sense now, and why not when they do not. */
function available(repo: Repo, op: OpState | null): Availability {
  const { branch, remotes } = repo;
  const busy = op?.status === 'running' ? `${opNames[op.kind]} is running.` : null;
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

function RepoView({ repo, threadId, state, actionError, dismissed, onDismiss, onSync, onCancel, onZoom, onClose }: {
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

function SyncBar({ repo, op, fetched, onSync, onCancel }: {
  repo: Repo; op: OpState | null; fetched: string | null; onSync: (op: OpKind) => void; onCancel: () => void;
}) {
  const can = available(repo, op);
  const running = op?.status === 'running' ? op : null;
  const { branch } = repo;
  const button = ({ kind, icon, label, count, tone }: { kind: OpKind; icon: string; label: string; count: number | null; tone: string }) => {
    const active = running?.kind === kind;
    return <button type="button" className="gg-sync" data-tone={tone} data-active={active || undefined}
      disabled={!can[kind].enabled && !active} title={active ? running?.progress?.phase ?? `${opNames[kind]}ing…` : can[kind].title}
      onClick={() => active ? onCancel() : onSync(kind)} aria-label={active ? `Cancel ${kind}` : can[kind].title}>
      {active ? <span className="gg-spinner gg-spinner-sm" /> : <Icon name={icon} className="size-3.5" />}
      <span className="gg-sync-label">{active ? running?.progress?.percent != null ? `${running.progress.percent}%` : `${opNames[kind]}ing` : label}</span>
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

function Fact({ tone, icon, title, children }: { tone: string; icon: string; title: string; children: React.ReactNode }) {
  return <span className="gg-fact" data-tone={tone} title={title}><Icon name={icon} className="size-3" />{children}</span>;
}

function DiffBar({ added, removed }: { added: number | null; removed: number | null }) {
  return <span className="gg-blocks" aria-hidden>
    {diffBlocks(added ?? 0, removed ?? 0).map((block, index) => <i key={index} data-block={block} />)}
  </span>;
}

/** A changed file, from the working tree or from one commit. */
type FileRow = Pick<Change, 'path' | 'origPath' | 'code' | 'added' | 'removed'>;

function ChangeRow({ file, source, threadId, open, onToggle, flash = null }: {
  file: FileRow; source: DiffSource; threadId: string; open: boolean; onToggle: () => void;
  /** Set when the row is new or changed in this update; a new value replays the highlight. */
  flash?: string | null;
}) {
  const { dir, name } = splitPath(file.path);
  const directory = file.path.endsWith('/');
  const counted = file.added !== null && file.removed !== null;
  const note = directory ? 'folder' : file.code === '?' ? 'new' : file.code === 'U' ? '' : 'binary';
  return <li className="gg-change" data-open={open || undefined}>
    {flash && <span className="gg-flash" key={flash} aria-hidden />}
    <button type="button" data-row className="gg-change-row" aria-expanded={directory ? undefined : open}
      disabled={directory} onClick={onToggle} title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}>
      <span className="gg-code" data-code={file.code} title={codeNames[file.code]}>{file.code === '?' ? 'U' : file.code === 'U' ? '!' : file.code}</span>
      <span className="gg-path">
        <span className="gg-name">{name}</span>
        {(dir || file.origPath) && <span className="gg-dir"><bdi>{file.origPath ? `from ${file.origPath}` : dir}</bdi></span>}
      </span>
      {counted
        ? <span className="gg-stat"><span className="gg-add">+{file.added}</span><span className="gg-del">−{file.removed}</span></span>
        : <span className="gg-stat gg-muted">{note}</span>}
      {counted ? <DiffBar added={file.added} removed={file.removed} /> : <span />}
      {!directory && <Icon name="ChevronDown" className="gg-row-chevron" />}
    </button>
    {open && <DiffPane file={file} source={source} threadId={threadId} />}
  </li>;
}

function DiffPane({ file, source, threadId }: { file: FileRow; source: DiffSource; threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const zoomed = useContext(Zoomed);
  const [result, setResult] = useState<{ patch: string; truncated: boolean } | { error: string } | null>(null);
  const sourceKey = JSON.stringify(source);
  useEffect(() => {
    let live = true;
    rpc.call('diff', { threadId, path: file.path, origPath: file.origPath, source: JSON.parse(sourceKey) as DiffSource })
      .then(value => { if (live) setResult(value); }, cause => { if (live) setResult({ error: message(cause) }); });
    return () => { live = false; };
  }, [rpc, threadId, file.path, file.origPath, file.added, file.removed, sourceKey]);
  if (!result) return <div className="gg-diff gg-diff-loading" aria-busy><i /><i /><i /></div>;
  if ('error' in result) return <div className="gg-diff gg-note gg-danger">{result.error}</div>;
  if (!result.patch.trim()) return <div className="gg-diff gg-note">No textual changes.</div>;
  return <div className="gg-diff">
    <Diff patch={result.patch} path={file.path} view={zoomed ? 'split' : 'unified'} overflow="scroll" className="gg-diff-view" />
    {result.truncated && <p className="gg-note">Diff truncated. Open lazygit for the rest.</p>}
  </div>;
}

function CommitList({ commits, threadId, now, copied, onCopy, fresh, stamp }: {
  commits: Commit[]; threadId: string; now: number; copied: string | null; onCopy: (sha: string) => void;
  fresh: Set<string>; stamp: string;
}) {
  const rows = useMemo(() => layoutGraph(commits), [commits]);
  const width = graphWidth(Math.max(...rows.map(row => row.width)));
  const [open, setOpen] = useState<string | null>(null);
  return <ol className="gg-commit-list">{commits.map((commit, index) => {
    const row = rows[index]!;
    const expanded = open === commit.sha;
    return <li key={commit.sha} data-open={expanded || undefined}>
      {fresh.has(commit.sha) && <span className="gg-flash" key={stamp} aria-hidden />}
      <button type="button" data-row data-sha={commit.sha} className="gg-commit" data-unpushed={commit.unpushed || undefined}
        aria-expanded={expanded} onClick={() => setOpen(expanded ? null : commit.sha)}
        title={`${commit.subject}\n${commit.author}${commit.unpushed ? ' · not pushed' : ''}`}>
        <GraphCell row={row} width={width} head={index === 0} unpushed={commit.unpushed} merge={commit.parents.length > 1} />
        <span className="gg-subject">{commit.subject}</span>
        {commit.refs.map(ref => <span key={`${ref.kind}:${ref.name}`} className="gg-ref" data-kind={ref.kind}
          style={ref.kind === 'head' ? { '--gg-ref': laneColour(row.lane) } as React.CSSProperties : undefined}>
          <Icon name={ref.kind === 'tag' ? 'Pin' : ref.kind === 'remote' ? 'Cloud' : 'GitBranch'} className="size-3" />{ref.name}
        </span>)}
        <span className="gg-meta">
          {copied === commit.sha ? <span className="gg-copied"><Icon name="Check" className="size-3" />Copied</span>
            : <><span className="gg-short">{commit.sha.slice(0, 7)}</span><span className="gg-age">{age(commit.time, now)}</span></>}
        </span>
        <Icon name="ChevronDown" className="gg-row-chevron" />
      </button>
      {expanded && <CommitPanel sha={commit.sha} threadId={threadId} now={now} copied={copied} onCopy={onCopy}
        lanes={[...new Set([...row.through, ...row.outgoing.map(segment => segment.to)])]} width={width} />}
    </li>;
  })}</ol>;
}

/** Lines for the lanes that continue past an expanded commit, so the graph stays joined. */
function LaneRails({ lanes, width }: { lanes: number[]; width: number }) {
  return <svg className="gg-rails" width={width} viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden>
    {lanes.map(lane => <line key={lane} x1={laneX(lane)} x2={laneX(lane)} y1={0} y2={100} stroke={laneColour(lane)} />)}
  </svg>;
}

function CommitPanel({ sha, threadId, now, copied, onCopy, lanes, width }: {
  sha: string; threadId: string; now: number; copied: string | null; onCopy: (sha: string) => void; lanes: number[]; width: number;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [detail, setDetail] = useState<CommitDetail | { error: string } | null>(null);
  const [file, setFile] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    rpc.call('commit', { threadId, sha }).then(value => { if (live) setDetail(value); }, cause => { if (live) setDetail({ error: message(cause) }); });
    return () => { live = false; };
  }, [rpc, threadId, sha]);
  const totals = detail && !('error' in detail)
    ? detail.files.reduce((sum, f) => ({ added: sum.added + (f.added ?? 0), removed: sum.removed + (f.removed ?? 0) }), { added: 0, removed: 0 }) : null;
  const authored = detail && !('error' in detail) ? new Date(detail.authoredAt * 1000) : null;
  return <div className="gg-commit-panel" style={{ '--gg-graph': `${width}px` } as React.CSSProperties}>
    <LaneRails lanes={lanes} width={width} />
    <div className="gg-commit-body">
      {!detail ? <div className="gg-diff-loading" aria-busy><i /><i /><i /></div>
        : 'error' in detail ? <p className="gg-note gg-danger">{detail.error}</p>
        : <>
          {detail.body && <p className="gg-message">{detail.body}</p>}
          <div className="gg-commit-meta">
            <span className="gg-avatar" aria-hidden>{initials(detail.author)}</span>
            <span><strong>{detail.author}</strong> <span title={authored!.toLocaleString('en-GB')}>{age(detail.authoredAt, now)} ago</span>
              {detail.committer !== detail.author && <span className="gg-muted"> · committed by {detail.committer}</span>}</span>
            <span className="gg-spacer" />
            {detail.parents.length > 1 && <span className="gg-tag">merge</span>}
            <button type="button" className="gg-fact gg-sha" data-tone="quiet" onClick={() => onCopy(detail.sha)} title="Copy full sha">
              <CopyIcon done={copied === detail.sha} />{copied === detail.sha ? 'Copied' : detail.sha.slice(0, 10)}
            </button>
          </div>
          <div className="gg-summary gg-commit-summary">
            <span><strong>{plural(detail.files.length + detail.hidden, 'file')}</strong> changed</span>
            {totals && (totals.added > 0 || totals.removed > 0) && <span className="gg-stat"><span className="gg-add">+{totals.added}</span><span className="gg-del">−{totals.removed}</span></span>}
            {totals && <DiffBar added={totals.added} removed={totals.removed} />}
          </div>
          <ul className="gg-commit-files">{detail.files.map(f => <ChangeRow key={f.path} file={f} source={{ kind: 'commit', sha: detail.sha }}
            threadId={threadId} open={file === f.path} onToggle={() => setFile(current => current === f.path ? null : f.path)} />)}</ul>
          {detail.hidden > 0 && <p className="gg-note">{plural(detail.hidden, 'more file')} not shown.</p>}
        </>}
    </div>
  </div>;
}

/** Copy and Check stacked, cross-faded, so the swap has both an exit and an entry. */
function CopyIcon({ done }: { done: boolean }) {
  return <span className="gg-swap" data-done={done || undefined} aria-hidden>
    <Icon name="Copy" className="size-3" /><Icon name="Check" className="size-3" />
  </span>;
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

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('') || '?';
