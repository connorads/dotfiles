import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { definePluginApp, experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { DiffViewMode, PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { PluginThreadPanelProps } from '@get-bb/plugin-sdk';
import type { Commit, FileDiff, LoadResult, Scope, ScopeKind, rpcContract } from './contracts.ts';
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

function DiffPanel({ threadId }: PluginThreadPanelProps) {
  const rpc: Rpc = useRpc<typeof rpcContract>();
  const [kind, setKind] = useState<ScopeKind>(() => lastScope.get(threadId) ?? 'uncommitted');
  const [commit, setCommit] = useState<string | null>(null);
  const [result, setResult] = useState<LoadResult | null>(null);
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
      const print = await rpc.call('fingerprint', { threadId });
      if (request === latest.current) printed.current = print;
      const next = await rpc.call('load', { threadId, scope });
      if (request !== latest.current) return;
      setResult(next);
      setError(null);
      // Whole-file fetches belong to the previous load; files the reader expanded fetch again.
      setFetched(new Map());
    } catch (cause) {
      if (request === latest.current) setError(message(cause));
    } finally {
      if (request === latest.current) { setLoading(false); settled.current = request; }
    }
  }, [rpc, threadId, scope]);

  useEffect(() => { lastScope.set(threadId, kind); }, [threadId, kind]);
  useEffect(() => { setResult(null); void reload(); }, [reload]);
  useEffect(() => {
    // Reload only when the fingerprint moved; skip while a load or another check is in flight.
    const check = async () => {
      if (document.visibilityState !== 'visible' || checking.current || settled.current !== latest.current) return;
      checking.current = true;
      const request = latest.current;
      try {
        const print = await rpc.call('fingerprint', { threadId });
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
  }, [rpc, threadId, reload]);
  useEffect(() => {
    // Opened by shortcut: take focus so j/k work at once, unless the reader is typing elsewhere.
    if (document.activeElement === document.body) rootRef.current?.focus({ preventScroll: true });
  }, []);

  const repo = result && result.kind !== 'none' ? result : null;
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
    rpc.call('file', { threadId, spec, path: file.path, oldPath: file.oldPath, untracked: file.untracked })
      .then(settle, cause => settle({ error: message(cause) }));
  }, [rpc, threadId, spec]);
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
      <span className="dv-spacer" />
      {repo?.view.ok && <span className="dv-summary">{files.length} {files.length === 1 ? 'file' : 'files'} <Counts {...sum} /></span>}
      <button type="button" className="dv-icon-button" onClick={flipView} aria-pressed={view === 'split'}
        title={view === 'split' ? 'Unified view (s)' : 'Split view (s)'} aria-label="Toggle split view">
        <Icon name={view === 'split' ? 'Rows2' : 'Columns2'} className="dv-icon" />
      </button>
      <button type="button" className="dv-icon-button" onClick={toggleAll} disabled={files.length === 0}
        title={anyOpen ? 'Collapse all (Shift+X)' : 'Expand all (Shift+X)'} aria-label={anyOpen ? 'Collapse all' : 'Expand all'}>
        <Icon name={anyOpen ? 'ChevronsUp' : 'ChevronsDown'} className="dv-icon" />
      </button>
      <button type="button" className="dv-icon-button" onClick={() => void reload()} title="Refresh (r)" aria-label="Refresh" data-busy={loading || undefined}>
        <Icon name="ArrowReloadHorizontal" className="dv-icon" />
      </button>
    </div>
    {repo && <div className="dv-context">
      <span className="dv-repo">{repo.name}{repo.branch && <span className="dv-muted"> · {repo.branch}</span>}</span>
      {repo.view.ok && <span className="dv-muted dv-label" title={repo.view.label}>{repo.view.label}</span>}
    </div>}
    {repo?.view.ok && repo.view.note && <p className="dv-note">{repo.view.note}</p>}
    {error && <p role="alert" className="dv-note dv-error">{error}</p>}

    <div ref={scrollRef} className="dv-scroll">
      {result === null ? !error && <p className="dv-blank">Loading changes…</p>
        : result.kind === 'none' ? <p className="dv-blank">This thread's checkout is not a git work tree.</p>
        : !result.view.ok ? <p className="dv-blank">{result.view.message}</p>
        : <>
          {result.view.commits && result.view.commits.length > 0 && <CommitList commits={result.view.commits} selected={commit} onSelect={setCommit} />}
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

export default definePluginApp(app => {
  app.slots.threadPanelAction({ id: 'diff', title: 'Diff viewer', icon: 'FileDiff', layout: 'flush', component: DiffPanel });
  app.commands.register({
    id: 'open', title: 'Diff viewer: Open', defaultShortcut: { key: 'd', mod: true, shift: true },
    isAvailable: ({ threadId }) => threadId !== null,
    run: context => { context.openPanel({ actionId: 'diff' }); },
  });
});
