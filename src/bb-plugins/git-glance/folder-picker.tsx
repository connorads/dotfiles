import { useEffect, useState } from 'react';
import { experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import { message } from './ui.tsx';

type Listing = { root: string; path: string; repository: boolean; folders: { name: string; repository: boolean }[] };

export function FolderPicker({ threadId, onSelected, onClose }: {
  threadId: string; onSelected: () => void; onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [path, setPath] = useState('.');
  const [listing, setListing] = useState<Listing | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setListing(null); setQuery(''); setError(null);
    rpc.call('folders', { threadId, path }).then(result => { if (live) setListing(result); }, cause => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [rpc, threadId, path]);
  const select = async (next: string | null) => {
    setBusy(true); setError(null);
    try { await rpc.call('select', { threadId, path: next }); onSelected(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };
  const parts = path === '.' ? [] : path.split('/');
  return <section className="gg-folder-picker" aria-label="Choose repository" onKeyDown={event => event.stopPropagation()}>
    <header className="gg-eyebrow"><strong>Choose repository</strong><span className="gg-spacer" />
      <button type="button" className="gg-ghost" disabled={busy} onClick={onClose}>Back to Git</button></header>
    <nav className="gg-breadcrumbs" aria-label="Folder path">
      <button type="button" disabled={busy} onClick={() => setPath('.')}>Thread folder</button>
      {parts.map((part, index) => <span key={index}> / <button type="button" disabled={busy}
        onClick={() => setPath(parts.slice(0, index + 1).join('/'))}>{part}</button></span>)}
    </nav>
    <input autoFocus className="gg-folder-search" aria-label="Find a folder" placeholder="Find a folder…"
      value={query} onChange={event => setQuery(event.target.value)} />
    {error && <p className="gg-note gg-danger" role="alert">{error}</p>}
    {listing ? <>
      <p className="gg-folder-path">{listing.root}</p>
      {listing.repository && <button type="button" className="gg-ghost" disabled={busy} onClick={() => void select(path)}>Use this repository</button>}
      <ul className="gg-folder-list" aria-label="Subfolders">
        {listing.folders.filter(folder => folder.name.toLowerCase().includes(query.toLowerCase())).map(folder => {
          const next = path === '.' ? folder.name : `${path}/${folder.name}`;
          return <li key={folder.name}>
            <button type="button" data-row disabled={busy} onClick={() => folder.repository ? void select(next) : setPath(next)}>
              <Icon name={folder.repository ? 'FolderGit' : 'Folder'} className="size-4" /><span>{folder.name}</span>
              <span className="gg-spacer" />{folder.repository ? <span className="gg-tag">Git</span> : <Icon name="ChevronRight" className="size-3" />}
            </button>
            {folder.repository && <button type="button" disabled={busy} aria-label={`Browse ${folder.name}`} onClick={() => setPath(next)}><Icon name="ChevronRight" className="size-3" /></button>}
          </li>;
        })}
      </ul>
      {!listing.folders.some(folder => folder.name.toLowerCase().includes(query.toLowerCase())) && <p className="gg-note">{query ? 'No matching folders.' : 'No subfolders.'}</p>}
    </> : !error && <p className="gg-note" role="status">Reading folders…</p>}
    <footer><button type="button" className="gg-ghost" disabled={busy} onClick={() => void select(null)}>Use thread checkout</button>
      <span className="gg-note">Selection applies to this Git panel.</span></footer>
  </section>;
}
