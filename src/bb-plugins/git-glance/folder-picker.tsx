import { useEffect, useRef, useState } from 'react';
import { experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { FolderList, HostRepo, RepositoryList, rpcContract } from './contracts.ts';
import type { Pick } from './src/recent-picks.ts';
import { breadcrumbs, isDirectPath, joinPath, rankHostRepos, rankRepositories, shortenPath, type HostCandidate } from './src/repo-search.ts';
import { message } from './ui.tsx';

const SHOWN = 50;
const HOST_SHOWN = 20;
const ELSEWHERE_SHOWN = 6;

/** A repository path with its parent folders muted and its name emphasised. */
function PathLabel({ path }: { path: string }) {
  const slash = path.lastIndexOf('/');
  return <span>{slash >= 0 && <span className="gg-folder-parent">{path.slice(0, slash + 1)}</span>}<strong>{path.slice(slash + 1)}</strong></span>;
}

function HostRepoLabel({ item, home }: { item: HostCandidate; home: string }) {
  const display = shortenPath(item.path, home);
  const base = item.path.slice(item.path.lastIndexOf('/') + 1);
  if (item.label && (item.source === 'dotfiles' || item.label.toLowerCase() !== base.toLowerCase())) {
    return <span><strong>{item.label}</strong><span className="gg-folder-path gg-worktree-path">{display}</span></span>;
  }
  return <PathLabel path={display} />;
}

/**
 * Browses and searches folders on the thread's host for a repository. As the empty state
 * of a checkout without one, it replaces the pop-up body and has nothing to go back to.
 */
export function FolderPicker({ threadId, embedded = false, onSelected, onClose, onBusy }: {
  threadId: string; embedded?: boolean;
  /** Resolves once the chosen repository shows; the picker stays busy until then. */
  onSelected: () => Promise<void>;
  onClose?: () => void; onBusy?: (busy: boolean) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [nav, setNav] = useState<{ path: string; keepQuery?: boolean; seq: number }>({ path: '.', seq: 0 });
  const [listing, setListing] = useState<FolderList | null>(null);
  const [meta, setMeta] = useState<{ base: string; home: string; dotfiles: boolean } | null>(null);
  const [nested, setNested] = useState<RepositoryList | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<Pick[]>([]);
  const [hostRepos, setHostRepos] = useState<HostRepo[]>([]);
  useEffect(() => {
    let live = true;
    rpc.call('recentPicks', { threadId }).then(result => {
      if (!live) return;
      setRecent(result.picks);
      setHostRepos(result.host ?? []);
    }, () => {});
    return () => { live = false; };
  }, [rpc, threadId]);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /** The folder just left by going up, so its row takes focus once the parent lists. */
  const cameFrom = useRef<string | null>(null);
  const openPath = (next: string, keepQuery = false) => {
    if (!keepQuery) setQuery('');
    setNav(current => ({ path: next, keepQuery, seq: current.seq + 1 }));
  };
  useEffect(() => {
    let live = true;
    if (!nav.keepQuery) { setListing(null); setNested(null); }
    setError(null);
    rpc.call('folders', { threadId, path: nav.path }).then(result => {
      if (!live) return;
      setListing(result);
      setMeta({ base: result.base, home: result.home, dotfiles: result.dotfiles });
      if (nav.keepQuery) { setQuery(''); setNested(null); }
      if (cameFrom.current === null) search.current?.focus();
      rpc.call('repositories', { threadId, path: result.root }).then(
        found => { if (live) setNested(found); },
        () => { if (live) setNested({ repositories: [], truncated: true }); },
      );
    }, cause => {
      if (!live) return;
      setError(message(cause));
      search.current?.focus();
    });
    return () => { live = false; };
  }, [rpc, threadId, nav]);
  useEffect(() => {
    if (!listing || cameFrom.current === null) return;
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-browse]') ?? []);
    (rows.find(row => row.dataset.browse === cameFrom.current) ?? search.current)?.focus();
    cameFrom.current = null;
  }, [listing]);
  const up = () => {
    if (!listing?.parent) return;
    cameFrom.current = listing.root;
    openPath(listing.parent);
  };
  const select = async (next: string | null, worktree?: string, fallbackBrowse = false) => {
    setBusy(true); onBusy?.(true); setError(null);
    try {
      await rpc.call('select', { threadId, path: next, ...worktree === undefined ? {} : { worktree } });
      await onSelected();
    } catch (cause) {
      const text = message(cause);
      if (fallbackBrowse && next && /not a git repository/i.test(text)) {
        openPath(next);
      } else {
        setError(text);
        search.current?.focus();
      }
    } finally { setBusy(false); onBusy?.(false); }
  };

  const home = meta?.home ?? '';
  const base = meta?.base ?? '';
  const currentRoot = listing?.root ?? '';
  const atBase = Boolean(listing && listing.root === listing.base);
  const atHome = Boolean(listing && listing.root === listing.home);
  const crumbs = listing ? breadcrumbs(listing.root, listing.home) : [];
  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();
  const searching = needle.length > 0;
  const directPath = isDirectPath(trimmed);
  const worktrees = listing?.worktrees.filter(tree => `${tree.branch ?? ''} ${tree.path}`.toLowerCase().includes(needle)) ?? [];
  const ranked = searching && nested ? rankRepositories(nested.repositories, needle) : [];
  const matches = ranked.slice(0, SHOWN);
  // While searching, repositories come from the nested scan; plain folders stay browsable.
  const folders = listing?.folders.filter(folder => folder.name.toLowerCase().includes(needle) && !(searching && folder.repository)) ?? [];

  const allHostCandidates: HostCandidate[] = [];
  const seenHost = new Set<string>();
  if (meta?.dotfiles && home) {
    seenHost.add(home);
    allHostCandidates.push({ path: home, label: 'dotfiles', source: 'dotfiles' });
  }
  for (const item of hostRepos) {
    if (seenHost.has(item.path)) continue;
    seenHost.add(item.path);
    allHostCandidates.push(item);
  }
  const localMatchPaths = new Set(matches.map(match => joinPath(currentRoot, match)));
  const hostMatches = searching
    ? rankHostRepos(allHostCandidates.filter(item => !localMatchPaths.has(item.path)), trimmed, home).slice(0, HOST_SHOWN)
    : [];
  const showRecent = !searching && atBase && recent.length > 0;
  const shownAtBase = new Set<string>([currentRoot]);
  if (atBase) {
    for (const pick of recent) shownAtBase.add(joinPath(base, pick.worktree ?? pick.path));
    for (const folder of folders) if (folder.repository) shownAtBase.add(joinPath(currentRoot, folder.name));
  }
  const elsewhere = !searching && atBase
    ? allHostCandidates.filter(item => !shownAtBase.has(item.path)).slice(0, ELSEWHERE_SHOWN)
    : [];

  const count = nested?.repositories.length ?? 0;
  const placeholder = !nested
    ? 'Find a repository or enter a path…'
    : nested.skipped
      ? 'Filter folders, search host repos, or enter a path…'
      : `Search ${count}${nested.truncated ? '+' : ''} ${count === 1 ? 'repository' : 'repositories'} or path…`;

  function keys(event: React.KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-row]') ?? []);
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const inSearch = event.target === search.current;
    const browse = rows[current]?.dataset.browse;
    if (inSearch && event.key === 'Enter') {
      event.preventDefault();
      rows[0]?.click();
    } else if (event.key === 'ArrowRight' && browse !== undefined) {
      event.preventDefault(); openPath(browse);
    } else if ((event.key === 'ArrowLeft' && (!inSearch || !query)) || (event.key === 'Backspace' && inSearch && !query)) {
      event.preventDefault(); up();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault(); rows[Math.min(rows.length - 1, current + 1)]?.focus();
    } else if (event.key === 'ArrowUp' && current >= 0) {
      event.preventDefault();
      if (current === 0) search.current?.focus(); else rows[current - 1]?.focus();
    }
  }

  return <section className="gg-folder-picker" aria-label="Choose repository" onKeyDown={keys}>
    <header className="gg-eyebrow">
      {embedded ? <><Icon name="FolderUnknown" className="size-4" /><strong>No repository here</strong><span>Choose a repository to inspect.</span></>
        : <strong>Choose repository</strong>}
      <span className="gg-spacer" />
      {onClose && <button type="button" className="gg-ghost" disabled={busy} onClick={onClose}>Back to Git</button>}
    </header>
    <div className="gg-folder-jumps" role="toolbar" aria-label="Quick locations">
      <button type="button" className="gg-ghost" disabled={busy || !listing?.parent} title="Up one folder (←)" onClick={up}>
        <Icon name="ArrowUp" className="size-3.5" />Up
      </button>
      <button type="button" className="gg-ghost" disabled={busy} aria-current={atBase ? 'location' : undefined} data-active={atBase || undefined}
        onClick={() => openPath(base || '.')}>Thread folder</button>
      {meta && <button type="button" className="gg-ghost" disabled={busy} aria-current={atHome ? 'location' : undefined} data-active={atHome || undefined}
        onClick={() => openPath(meta.home)}><Icon name="Home" className="size-3.5" />Home</button>}
      {meta?.dotfiles && <button type="button" className="gg-ghost" disabled={busy} title={`Select dotfiles (${meta.home})`}
        onClick={() => void select(meta.home)}><Icon name="FolderGit" className="size-3.5" />Dotfiles</button>}
    </div>
    {crumbs.length > 0 && <nav className="gg-breadcrumbs" aria-label="Folder path">
      {crumbs.map((crumb, index) => <span key={crumb.path}>
        {index > 0 && (crumbs[index - 1]!.label === '/' ? ' ' : ' / ')}
        <button type="button" disabled={busy} onClick={() => openPath(crumb.path)}>{crumb.label}</button>
      </span>)}
    </nav>}
    <input ref={search} className="gg-folder-search" aria-label="Find a repository, folder, worktree or path" placeholder={placeholder}
      value={query} onChange={event => setQuery(event.target.value)} />
    {error && <p className="gg-note gg-danger" role="alert">{error}</p>}
    {listing ? <div ref={list} className="gg-folder-results">
      <p className="gg-folder-path">{listing.root}</p>
      {directPath && <ul className="gg-folder-list" aria-label="Open path">
        <li>
          <button type="button" data-row disabled={busy} onClick={() => openPath(trimmed, true)}>
            <Icon name="Folder" className="size-4" /><span>Open folder <strong>{trimmed}</strong></span>
            <span className="gg-spacer" /><kbd className="gg-tag">↵</kbd>
          </button>
        </li>
      </ul>}
      {listing.repository && !searching && <button type="button" data-row className="gg-ghost" disabled={busy} onClick={() => void select(listing.root)}>
        {listing.repoKind === 'dotfiles' ? 'Use dotfiles' : 'Use this repository'}
      </button>}
      {searching && matches.length > 0 && <>
        <ul className="gg-folder-list" aria-label="Repositories">
          {matches.map((match, index) => {
            const abs = joinPath(listing.root, match);
            return <li key={match}>
              <button type="button" data-row data-browse={abs} disabled={busy} onClick={() => void select(abs)}>
                <Icon name="FolderGit" className="size-4" /><PathLabel path={match} />
                <span className="gg-spacer" />{!directPath && index === 0 && <kbd className="gg-tag">↵</kbd>}
              </button>
              <button type="button" disabled={busy} aria-label={`Browse ${match} and worktrees`} title="Browse folders and worktrees" onClick={() => openPath(abs)}><Icon name="ChevronRight" className="size-3" /></button>
            </li>;
          })}
        </ul>
        {ranked.length > SHOWN && <p className="gg-note">{ranked.length - SHOWN} more. Type more to narrow the list.</p>}
      </>}
      {searching && !nested && <p className="gg-note" role="status">Searching subfolders…</p>}
      {searching && nested?.truncated && <p className="gg-note">Search stopped at its size limit. Open a folder to search inside it.</p>}
      {searching && hostMatches.length > 0 && <>
        <h3 className="gg-eyebrow">Elsewhere on this host</h3>
        <ul className="gg-folder-list" aria-label="Repositories on this host">
          {hostMatches.map((item, index) => <li key={item.path}>
            <button type="button" data-row data-browse={item.source === 'dotfiles' ? undefined : item.path} disabled={busy} title={item.path}
              onClick={() => void select(item.path, undefined, item.source === 'project')}>
              <Icon name={item.source === 'dotfiles' ? 'Home' : item.source === 'recent' ? 'Clock' : 'FolderGit'} className="size-4" />
              <HostRepoLabel item={item} home={home} />
              <span className="gg-spacer" />
              {item.source === 'dotfiles' ? <span className="gg-tag">bare</span> : item.source === 'project' ? <span className="gg-tag">Project</span> : null}
              {!directPath && matches.length === 0 && index === 0 && <kbd className="gg-tag">↵</kbd>}
            </button>
            {item.source !== 'dotfiles' && <button type="button" disabled={busy} aria-label={`Browse ${item.label ?? item.path} and worktrees`} title="Browse folders and worktrees" onClick={() => openPath(item.path)}><Icon name="ChevronRight" className="size-3" /></button>}
          </li>)}
        </ul>
      </>}
      {showRecent && <>
        <h3 className="gg-eyebrow">Recent</h3>
        <ul className="gg-folder-list" aria-label="Recent repositories">
          {recent.map((pick, index) => {
            const abs = joinPath(base, pick.path);
            const display = pick.worktree
              ? shortenPath(pick.worktree, home)
              : pick.path.startsWith('/') ? shortenPath(pick.path, home) : pick.path;
            return <li key={`${pick.path}\0${pick.worktree ?? ''}`}>
              <button type="button" data-row data-browse={pick.worktree === undefined ? abs : undefined} disabled={busy} title={pick.worktree ?? abs} onClick={() => void select(pick.path, pick.worktree)}>
                <Icon name="Clock" className="size-4" /><PathLabel path={display} />
                <span className="gg-spacer" />{index === 0 && <kbd className="gg-tag">↵</kbd>}
              </button>
            </li>;
          })}
        </ul>
      </>}
      {worktrees.length > 0 && <>
        <h3 className="gg-eyebrow">Checkouts and worktrees</h3>
        <ul className="gg-folder-list" aria-label="Checkouts and worktrees">
          {worktrees.map(tree => <li key={tree.path}>
            <button type="button" data-row disabled={busy} title={tree.path} onClick={() => void select(listing.root, tree.path)}>
              <Icon name="GitBranch" className="size-4" /><span><strong>{tree.branch ?? 'Detached HEAD'}</strong><span className="gg-folder-path gg-worktree-path">{tree.path}</span></span>
            </button>
          </li>)}
        </ul>
      </>}
      {(searching || showRecent) && folders.length > 0 && <h3 className="gg-eyebrow">Folders</h3>}
      {folders.length > 0 && <ul className="gg-folder-list" aria-label="Subfolders">
        {folders.map(folder => {
          const next = joinPath(listing.root, folder.name);
          return <li key={folder.name}>
            <button type="button" data-row data-browse={next} disabled={busy} onClick={() => folder.repository ? void select(next) : openPath(next)}>
              <Icon name={folder.repository ? 'FolderGit' : 'Folder'} className="size-4" /><span>{folder.name}</span>
              <span className="gg-spacer" />{folder.repository ? <span className="gg-tag">Git</span> : <Icon name="ChevronRight" className="size-3" />}
            </button>
            {folder.repository && <button type="button" disabled={busy} aria-label={`Browse ${folder.name} and worktrees`} title="Browse folders and worktrees" onClick={() => openPath(next)}><Icon name="ChevronRight" className="size-3" /></button>}
          </li>;
        })}
      </ul>}
      {elsewhere.length > 0 && <>
        <h3 className="gg-eyebrow">Elsewhere on this host</h3>
        <ul className="gg-folder-list" aria-label="Repositories on this host">
          {elsewhere.map(item => <li key={item.path}>
            <button type="button" data-row data-browse={item.source === 'dotfiles' ? undefined : item.path} disabled={busy} title={item.path}
              onClick={() => void select(item.path, undefined, item.source === 'project')}>
              <Icon name={item.source === 'dotfiles' ? 'Home' : item.source === 'recent' ? 'Clock' : 'FolderGit'} className="size-4" />
              <HostRepoLabel item={item} home={home} />
              <span className="gg-spacer" />
              {item.source === 'dotfiles' ? <span className="gg-tag">bare</span> : item.source === 'project' ? <span className="gg-tag">Project</span> : null}
            </button>
            {item.source !== 'dotfiles' && <button type="button" disabled={busy} aria-label={`Browse ${item.label ?? item.path} and worktrees`} title="Browse folders and worktrees" onClick={() => openPath(item.path)}><Icon name="ChevronRight" className="size-3" /></button>}
          </li>)}
        </ul>
      </>}
      {!directPath && !matches.length && !hostMatches.length && !folders.length && !worktrees.length && !elsewhere.length && (nested || !searching)
        && <p className="gg-note">{searching
          ? nested?.skipped
            ? 'No matching folders or host repositories. Open a folder to search inside it.'
            : 'No matching repositories, folders or worktrees.'
          : 'No subfolders or worktrees.'}</p>}
    </div> : !error && <p className="gg-note" role="status">Reading folders…</p>}
    <footer>{!embedded && <button type="button" className="gg-ghost" disabled={busy} onClick={() => void select(null)}>Use thread checkout</button>}
      <span className="gg-note"><kbd>↵</kbd> select · <kbd>→</kbd> open · <kbd>←</kbd> up. The thread folder stays unchanged.</span></footer>
  </section>;
}
