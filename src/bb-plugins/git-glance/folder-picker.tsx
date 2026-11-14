import { useEffect, useRef, useState } from 'react';
import { experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { FolderList, RepositoryList, rpcContract } from './contracts.ts';
import { rankRepositories } from './src/repo-search.ts';
import { message } from './ui.tsx';

const SHOWN = 50;

/**
 * Browses and searches the thread checkout for a repository. As the empty state
 * of a checkout without one, it replaces the pop-up body and has nothing to go back to.
 */
export function FolderPicker({ threadId, embedded = false, onSelected, onClose }: {
  threadId: string; embedded?: boolean; onSelected: () => void; onClose?: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [path, setPath] = useState('.');
  const [listing, setListing] = useState<FolderList | null>(null);
  const [nested, setNested] = useState<RepositoryList | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setListing(null); setNested(null); setQuery(''); setError(null);
    rpc.call('folders', { threadId, path }).then(result => { if (live) setListing(result); }, cause => { if (live) setError(message(cause)); });
    rpc.call('repositories', { threadId, path }).then(result => { if (live) setNested(result); }, () => { if (live) setNested({ repositories: [], truncated: true }); });
    search.current?.focus();
    return () => { live = false; };
  }, [rpc, threadId, path]);
  const select = async (next: string | null, worktree?: string) => {
    setBusy(true); setError(null);
    try { await rpc.call('select', { threadId, path: next, ...worktree === undefined ? {} : { worktree } }); onSelected(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };
  const join = (child: string) => path === '.' ? child : `${path}/${child}`;
  const parts = path === '.' ? [] : path.split('/');
  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;
  const worktrees = listing?.worktrees.filter(tree => `${tree.branch ?? ''} ${tree.path}`.toLowerCase().includes(needle)) ?? [];
  const ranked = searching && nested ? rankRepositories(nested.repositories, needle) : [];
  const matches = ranked.slice(0, SHOWN);
  // While searching, repositories come from the nested scan; plain folders stay browsable.
  const folders = listing?.folders.filter(folder => folder.name.toLowerCase().includes(needle) && !(searching && folder.repository)) ?? [];
  const count = nested?.repositories.length ?? 0;
  const placeholder = !nested ? 'Find a repository…' : `Search ${count}${nested.truncated ? '+' : ''} ${count === 1 ? 'repository' : 'repositories'}…`;

  function keys(event: React.KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-row]') ?? []);
    const current = rows.indexOf(document.activeElement as HTMLElement);
    if (event.target === search.current && event.key === 'Enter') {
      event.preventDefault();
      if (searching && matches[0]) void select(join(matches[0]));
      else rows[0]?.click();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault(); rows[Math.min(rows.length - 1, current + 1)]?.focus();
    } else if (event.key === 'ArrowUp' && current >= 0) {
      event.preventDefault();
      if (current === 0) search.current?.focus(); else rows[current - 1]?.focus();
    }
  }

  return <section className="gg-folder-picker" aria-label="Choose repository" onKeyDown={keys}>
    <header className="gg-eyebrow">
      {embedded ? <><Icon name="FolderUnknown" className="size-4" /><strong>No repository here</strong><span>Choose one inside this folder.</span></>
        : <strong>Choose repository</strong>}
      <span className="gg-spacer" />
      {onClose && <button type="button" className="gg-ghost" disabled={busy} onClick={onClose}>Back to Git</button>}
    </header>
    <nav className="gg-breadcrumbs" aria-label="Folder path">
      <button type="button" disabled={busy} onClick={() => setPath('.')}>Thread folder</button>
      {parts.map((part, index) => <span key={index}> / <button type="button" disabled={busy}
        onClick={() => setPath(parts.slice(0, index + 1).join('/'))}>{part}</button></span>)}
    </nav>
    <input ref={search} className="gg-folder-search" aria-label="Find a repository, folder or worktree" placeholder={placeholder}
      value={query} onChange={event => setQuery(event.target.value)} />
    {error && <p className="gg-note gg-danger" role="alert">{error}</p>}
    {listing ? <div ref={list} className="gg-folder-results">
      <p className="gg-folder-path">{listing.root}</p>
      {listing.repository && !searching && <button type="button" className="gg-ghost" disabled={busy} onClick={() => void select(path)}>Use this repository</button>}
      {searching && <>
        <ul className="gg-folder-list" aria-label="Repositories">
          {matches.map((match, index) => {
            const slash = match.lastIndexOf('/');
            return <li key={match}>
              <button type="button" data-row disabled={busy} onClick={() => void select(join(match))}>
                <Icon name="FolderGit" className="size-4" />
                <span>{slash >= 0 && <span className="gg-folder-parent">{match.slice(0, slash + 1)}</span>}<strong>{match.slice(slash + 1)}</strong></span>
                <span className="gg-spacer" />{index === 0 && <kbd className="gg-tag">↵</kbd>}
              </button>
              <button type="button" disabled={busy} aria-label={`Browse ${match} and worktrees`} title="Browse folders and worktrees" onClick={() => setPath(join(match))}><Icon name="ChevronRight" className="size-3" /></button>
            </li>;
          })}
        </ul>
        {ranked.length > SHOWN && <p className="gg-note">{ranked.length - SHOWN} more. Type more to narrow the list.</p>}
        {!nested && <p className="gg-note" role="status">Searching subfolders…</p>}
        {nested?.truncated && <p className="gg-note">Search stopped at its size limit. Open a folder to search inside it.</p>}
      </>}
      {worktrees.length > 0 && <>
        <h3 className="gg-eyebrow">Checkouts and worktrees</h3>
        <ul className="gg-folder-list" aria-label="Checkouts and worktrees">
          {worktrees.map(tree => <li key={tree.path}>
            <button type="button" data-row disabled={busy} title={tree.path} onClick={() => void select(path, tree.path)}>
              <Icon name="GitBranch" className="size-4" /><span><strong>{tree.branch ?? 'Detached HEAD'}</strong><span className="gg-folder-path gg-worktree-path">{tree.path}</span></span>
            </button>
          </li>)}
        </ul>
      </>}
      {searching && folders.length > 0 && <h3 className="gg-eyebrow">Folders</h3>}
      <ul className="gg-folder-list" aria-label="Subfolders">
        {folders.map(folder => {
          const next = join(folder.name);
          return <li key={folder.name}>
            <button type="button" data-row disabled={busy} onClick={() => folder.repository ? void select(next) : setPath(next)}>
              <Icon name={folder.repository ? 'FolderGit' : 'Folder'} className="size-4" /><span>{folder.name}</span>
              <span className="gg-spacer" />{folder.repository ? <span className="gg-tag">Git</span> : <Icon name="ChevronRight" className="size-3" />}
            </button>
            {folder.repository && <button type="button" disabled={busy} aria-label={`Browse ${folder.name} and worktrees`} title="Browse folders and worktrees" onClick={() => setPath(next)}><Icon name="ChevronRight" className="size-3" /></button>}
          </li>;
        })}
      </ul>
      {!matches.length && !folders.length && !worktrees.length && (nested || !searching)
        && <p className="gg-note">{searching ? 'No matching repositories, folders or worktrees.' : 'No subfolders or worktrees.'}</p>}
    </div> : !error && <p className="gg-note" role="status">Reading folders…</p>}
    <footer>{!embedded && <button type="button" className="gg-ghost" disabled={busy} onClick={() => void select(null)}>Use thread checkout</button>}
      <span className="gg-note">Search finds repositories in subfolders. The thread folder stays unchanged.</span></footer>
  </section>;
}
