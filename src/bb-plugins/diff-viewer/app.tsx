import { z } from 'zod';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { definePluginApp, experimental_Icon as Icon, useRpc, useBbNavigate } from '@get-bb/plugin-sdk/app';
import type { DiffViewMode, PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { PluginThreadPanelProps, PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { Commit, FileDiff, LoadResult, Review, Scope, ScopeKind, rpcContract } from './contracts.ts';
import { reviewSchema } from './contracts.ts';
import { mountReviewLinks, openReviewEvent } from './review-links.ts';
import { Counts, FileCard, FilePath, type Fetched } from './file-card.tsx';
import { age, currentFile, defaultCollapsed, neighbour, statusLetter, totals } from './src/view.ts';
import './app.css';

type Rpc = PluginRpcClient<typeof rpcContract>;
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

const scopes: { kind: ScopeKind; label: string; hint: string }[] = [
  { kind: 'uncommitted', label: 'Uncommitted', hint: 'Working tree and staged changes against HEAD' },
  { kind: 'unpushed', label: 'Unpushed', hint: 'Commits not on the upstream, cumulative' },
  { kind: 'branch', label: 'Branch', hint: 'Everything since the merge base with the default branch, uncommitted included' },
];

/** The scope each thread last showed, so reopening the panel keeps it. */
const lastScope = new Map<string, ScopeKind>();
const viewKey = 'bb-diff-viewer:view';
const readView = (): DiffViewMode => { try { return localStorage.getItem(viewKey) === 'split' ? 'split' : 'unified'; } catch { return 'unified'; } };
/** How often a visible panel checks the checkout's fingerprint for changes. */
const pollMs = 4_000;

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function CommitList({ commits, selected, onSelect }: { commits: Commit[]; selected: string | null; onSelect: (sha: string | null) => void }) {
  const now = Date.now();
  return <ol className="dv-commits" aria-label="Unpushed commits">
    <li><button type="button" className="dv-commit" aria-current={selected === null} onClick={() => onSelect(null)}>
      <span className="dv-commit-sha">all</span><span className="dv-commit-subject">All {commits.length} commits, cumulative</span>
    </button></li>
    {commits.map(commit => <li key={commit.sha}>
      <button type="button" className="dv-commit" aria-current={selected === commit.sha} onClick={() => onSelect(commit.sha)}>
        <span className="dv-commit-sha">{commit.shortSha}</span>
        <span className="dv-commit-subject">{commit.subject}</span>
        <span className="dv-muted">{age(commit.time, now)}</span>
      </button>
    </li>)}
  </ol>;
}

function FileIndex({ files, onJump }: { files: FileDiff[]; onJump: (path: string) => void }) {
  return <nav className="dv-index" aria-label="Changed files">
    {files.map(file => <button type="button" key={file.path} className="dv-index-row" onClick={() => onJump(file.path)}>
      <span className="dv-status" data-status={file.status}>{statusLetter[file.status]}</span>
      <FilePath path={file.path} />
      <Counts additions={file.additions} deletions={file.deletions} />
    </button>)}
  </nav>;
}

function DiffPanelContent({ threadId, review }: PluginThreadPanelProps & { review: Review | null }) {
  const rpc: Rpc = useRpc<typeof rpcContract>();
  const target = useMemo(() => review ? { target: review.target } : {}, [review]);
  const [kind, setKind] = useState<ScopeKind>(() => review?.scope.kind ?? lastScope.get(threadId) ?? 'uncommitted');
  const [commit, setCommit] = useState<string | null>(review?.scope.kind === 'unpushed' ? review.scope.commit : null);
  /** The last successful load and the scope it was for. */
  const [loaded, setLoaded] = useState<{ scope: Scope; result: LoadResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<DiffViewMode>(readView);
  /** The reader's collapse choices by path; unset paths use the default. */
  const [collapsed, setCollapsed] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [fetched, setFetched] = useState<ReadonlyMap<string, Fetched>>(new Map());
  const [wantFull, setWantFull] = useState<ReadonlySet<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const latest = useRef(0);
  const settled = useRef(0);
  /** The checkout's fingerprint when the shown load began. */
  const printed = useRef<string | null>(null);
  const checking = useRef(false);

  const scope = useMemo<Scope>(() => kind === 'unpushed' ? { kind, commit } : { kind }, [kind, commit]);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    try {
      // Taken before the load, so a change during the load shows at the next check.
      const print = await rpc.call('fingerprint', { threadId, ...target });
      if (request === latest.current) printed.current = print;
      const next = await rpc.call('load', { threadId, ...target, scope });
      if (request !== latest.current) return;
      setLoaded({ scope, result: next });
      setError(null);
      // Whole-file fetches belong to the previous load; files the reader expanded fetch again.
      setFetched(new Map());
    } catch (cause) {
      if (request === latest.current) {
        setError(message(cause));
        // The shown diff no longer matches any fingerprint, so the next check retries the load.
        printed.current = null;
      }
    } finally {
      if (request === latest.current) { setLoading(false); settled.current = request; }
    }
  }, [rpc, threadId, target, scope]);

  useEffect(() => { lastScope.set(threadId, kind); }, [threadId, kind]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    // Reload only when the fingerprint moved; skip while a load or another check is in flight.
    const check = async () => {
      if (document.visibilityState !== 'visible' || checking.current || settled.current !== latest.current) return;
      checking.current = true;
      const request = latest.current;
      try {
        const print = await rpc.call('fingerprint', { threadId, ...target });
        if (request === latest.current && print !== printed.current) void reload();
      } catch { /* the next check tries again */ } finally { checking.current = false; }
    };
    const refresh = () => void check();
    const timer = setInterval(refresh, pollMs);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [rpc, threadId, target, reload]);
  useEffect(() => {
    // Opened by shortcut: take focus so j/k work at once, unless the reader is typing elsewhere.
    if (document.activeElement === document.body) rootRef.current?.focus({ preventScroll: true });
  }, []);

  // A load for another scope is not shown: its files would read as this scope's.
  const result = loaded?.scope === scope ? loaded.result : null;
  const repo = result && result.kind !== 'none' ? result : null;
  // Checkout name and branch do not depend on the scope, so they stay while another scope loads.
  const checkout = loaded && loaded.result.kind !== 'none' ? loaded.result : null;
  // Picking a commit keeps the list in place (and its scroll) while that commit loads.
  const commits = kind === 'unpushed' && loaded?.scope.kind === 'unpushed' && checkout?.view.ok ? checkout.view.commits : null;
  const files = repo?.view.ok ? repo.view.files : [];
  const isCollapsed = useCallback((file: FileDiff) => collapsed.get(file.path) ?? defaultCollapsed(file), [collapsed]);
  const spec = repo?.view.ok ? repo.view.spec : null;

  const toggle = useCallback((path: string) => {
    const file = files.find(f => f.path === path);
    if (file) setCollapsed(map => new Map(map).set(path, !(map.get(path) ?? defaultCollapsed(file))));
  }, [files]);
  const anyOpen = files.some(file => !isCollapsed(file));
  const toggleAll = () => setCollapsed(new Map(files.map(file => [file.path, anyOpen])));

  // Each load yields a new spec object, so a fetch that outlives its load is dropped.
  const specRef = useRef(spec);
  specRef.current = spec;
  const fetchFile = useCallback((file: FileDiff) => {
    if (!spec) return;
    const settle = (value: Fetched) => { if (specRef.current === spec) setFetched(map => new Map(map).set(file.path, value)); };
    settle('loading');
    rpc.call('file', { threadId, ...target, spec, path: file.path, oldPath: file.oldPath, untracked: file.untracked })
      .then(settle, cause => settle({ error: message(cause) }));
  }, [rpc, threadId, target, spec]);
  const askFull = useCallback((path: string) => setWantFull(set => new Set(set).add(path)), []);

  const sections = (): HTMLElement[] => scrollRef.current ? Array.from(scrollRef.current.querySelectorAll<HTMLElement>('.dv-file')) : [];
  const jumpTo = (path: string) => {
    const section = sections().find(node => node.dataset.path === path);
    if (!section || !scrollRef.current) return;
    scrollRef.current.scrollTo({ top: section.offsetTop });
    section.querySelector<HTMLButtonElement>('.dv-file-toggle')?.focus({ preventScroll: true });
  };
  const jumpFrom = (direction: 1 | -1) => {
    const nodes = sections();
    const index = neighbour(nodes.map(node => node.offsetTop), scrollRef.current?.scrollTop ?? 0, direction);
    if (index !== null) jumpTo(nodes[index]!.dataset.path!);
  };
  const toggleCurrent = () => {
    const nodes = sections();
    const index = currentFile(nodes.map(node => node.offsetTop), scrollRef.current?.scrollTop ?? 0);
    const path = nodes[Math.max(index, 0)]?.dataset.path;
    if (path) { toggle(path); jumpTo(path); }
  };
  const flipView = () => setView(current => {
    const next = current === 'split' ? 'unified' : 'split';
    try { localStorage.setItem(viewKey, next); } catch { /* storage unavailable: keep it for this session */ }
    return next;
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    const actions: Record<string, () => void> = {
      j: () => jumpFrom(1), n: () => jumpFrom(1), k: () => jumpFrom(-1), p: () => jumpFrom(-1),
      x: toggleCurrent, X: toggleAll, s: flipView, r: () => void reload(),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  const sum = totals(files);
  return <div ref={rootRef} className="dv-panel" tabIndex={-1} onKeyDown={onKeyDown}>
    <div className="dv-toolbar">
      <div className="dv-scopes" role="tablist" aria-label="Compare">
        {scopes.map(option => <button type="button" role="tab" key={option.kind} aria-selected={kind === option.kind} title={option.hint}
          onClick={() => { setKind(option.kind); setCommit(null); }}>{option.label}</button>)}
      </div>
      <div className="dv-tools">
        {repo?.view.ok && <span className="dv-summary">{files.length} {files.length === 1 ? 'file' : 'files'} <Counts {...sum} /></span>}
        <div className="dv-actions">
          <button type="button" className="dv-icon-button" onClick={flipView} aria-pressed={view === 'split'}
            title={view === 'split' ? 'Unified view (s)' : 'Split view (s)'} aria-label="Toggle split view">
            <Icon name={view === 'split' ? 'Rows2' : 'Columns2'} className="dv-icon" />
          </button>
          <button type="button" className="dv-icon-button" onClick={toggleAll} disabled={files.length === 0}
            title={anyOpen ? 'Collapse all (Shift+X)' : 'Expand all (Shift+X)'} aria-label={anyOpen ? 'Collapse all' : 'Expand all'}>
            <Icon name={anyOpen ? 'ChevronsUp' : 'ChevronsDown'} className="dv-icon" />
          </button>
          <button type="button" className="dv-icon-button" onClick={() => void reload()} title="Refresh (r)" aria-label="Refresh"
            data-busy={loading || undefined} aria-busy={loading}>
            <Icon name="ArrowReloadHorizontal" className="dv-icon" />
          </button>
        </div>
      </div>
    </div>
    {checkout && <div className="dv-context">
      <span className="dv-repo">{review?.target.path ?? checkout.name}{checkout.branch && <span className="dv-muted"> · {checkout.branch}</span>}</span>
      {repo?.view.ok && <span className="dv-muted dv-label" title={repo.view.label}>{repo.view.label}</span>}
    </div>}
    {repo?.view.ok && repo.view.note && <p className="dv-note">{repo.view.note}</p>}
    {error && <p role="alert" className="dv-note dv-error">
      {result ? 'Refresh failed. Showing the last loaded changes.' : 'Could not load changes.'} {error}{' '}
      <button type="button" className="dv-link" onClick={() => void reload()} disabled={loading}>Retry</button>
    </p>}

    <div ref={scrollRef} className="dv-scroll">
      {commits && commits.length > 0 && <CommitList commits={commits} selected={commit} onSelect={setCommit} />}
      {result === null ? !error && <p className="dv-blank">Loading changes…</p>
        : result.kind === 'none' ? <p className="dv-blank">This thread's checkout is not a git work tree.</p>
        : !result.view.ok ? <p className="dv-blank">{result.view.message}</p>
        : <>
          {files.length === 0 ? <p className="dv-blank">No changes.</p> : <>
            <FileIndex files={files} onJump={path => {
              const file = files.find(f => f.path === path);
              if (file && isCollapsed(file)) toggle(path);
              requestAnimationFrame(() => jumpTo(path));
            }} />
            {result.view.hidden > 0 && <p className="dv-note">{result.view.hidden} more files are not shown.</p>}
            <div className="dv-files">
              {files.map(file => <FileCard key={file.path} file={file} collapsed={isCollapsed(file)} view={view}
                fetched={fetched.get(file.path)} wantFull={wantFull.has(file.path)}
                onToggle={toggle} onFetch={fetchFile} onWantFull={askFull} />)}
            </div>
            <p className="dv-end dv-muted">j/k or n/p: next/previous file · x: collapse · Shift+X: all · s: split · r: refresh</p>
          </>}
        </>}
    </div>
  </div>;
}

function DiffPanel(props: PluginThreadPanelProps) {
  const review = useMemo(() => {
    const parsed = reviewSchema.safeParse(props.params);
    return parsed.success ? parsed.data : null;
  }, [props.params]);
  if (props.params !== null && review === null) return <p role="alert">Invalid review target.</p>;
  return <DiffPanelContent key={`${props.threadId}:${JSON.stringify(props.params)}`} {...props} review={review} />;
}

function ReviewOpener({ threadId }: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      const parsed = reviewSchema.extend({ threadId: z.string() }).safeParse(detail);
      if (!parsed.success) return;
      if (parsed.data.threadId !== threadId) return;
      const opened = navigate.openThreadPanel({ actionId: 'diff', title: 'Diff viewer', params: { target: parsed.data.target, scope: parsed.data.scope } });
      if (opened) event.preventDefault();
      setError(opened ? null : 'Open a thread to review this checkout.');
    };
    window.addEventListener(openReviewEvent, open);
    return () => window.removeEventListener(openReviewEvent, open);
  }, [navigate, threadId]);
  return error ? <div className="dv-open-error" role="alert">
    <span>{error}</span> <button type="button" className="dv-link" onClick={() => setError(null)}>Dismiss</button>
  </div> : null;
}

export default definePluginApp(app => {
  app.contentScripts.register({ id: 'review-links', mount: () => mountReviewLinks(document, detail => { window.dispatchEvent(new CustomEvent(openReviewEvent, { detail })); }) });
  app.slots.experimental_threadHeaderAction({ id: 'review-opener', title: 'Open review', component: ReviewOpener });
  app.slots.threadPanelAction({ id: 'diff', title: 'Diff viewer', icon: 'FileDiff', layout: 'flush', component: DiffPanel });
  app.commands.register({
    id: 'open', title: 'Open diff viewer', defaultShortcut: { key: 'd', mod: true, shift: true },
    isAvailable: ({ threadId }) => threadId !== null,
    run: context => { context.openPanel({ actionId: 'diff' }); },
  });
});
