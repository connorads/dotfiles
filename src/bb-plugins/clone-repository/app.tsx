import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { definePluginApp, experimental_useSidebarThreads, useBbNavigate, useComposers, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginComposerApi } from '@get-bb/plugin-sdk';
import type { Repository, rpcContract } from './contracts.ts';
import { parseRepository } from './src/repositories.ts';
import './app.css';

interface Launch {
  composer?: PluginComposerApi;
  projectId: string | null;
  threadId: string | null;
  returnFocus: HTMLElement | null;
}
let launched: Launch | null = null;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function launch(context: Omit<Launch, 'returnFocus'>) {
  if (launched) return;
  launched = { ...context, returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null };
  listeners.forEach(listener => listener());
}
function close() { launched = null; listeners.forEach(listener => listener()); }
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
type Existing = { repository: string; projectId: string; path: string };
type Operation = { kind: 'idle' } | { kind: 'busy'; stage: 'checkout' | 'project' | 'composer' } | { kind: 'error'; stage: 'clone' | 'register' | 'composer'; message: string };

function Picker({ request }: { request: Launch }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const sidebar = experimental_useSidebarThreads();
  const latestSidebar = useRef(sidebar);
  latestSidebar.current = sidebar;
  const projectWaiters = useRef(new Set<() => void>());
  const lifetime = useRef(new AbortController());
  useEffect(() => { projectWaiters.current.forEach(check => check()); });
  const composers = useComposers();
  const latestComposers = useRef(composers);
  latestComposers.current = composers;
  const [source] = useState(() => request.composer ?? (request.threadId === null
    ? composers.find(composer => composer.scope.kind === 'new-thread' && composer.scope.projectId === request.projectId)
      ?? composers.find(composer => composer.scope.kind === 'new-thread')
    : undefined));
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const destinationInput = useRef<HTMLInputElement>(null);
  const focusDestination = useRef(false);
  const listId = useId();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [existing, setExisting] = useState<Existing[]>([]);
  const [root, setRoot] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [destination, setDestination] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [operation, setOperation] = useState<Operation>({ kind: 'idle' });
  const busy = operation.kind === 'busy';
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    return () => { mounted.current = false; lifetime.current.abort(); };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    search.current?.focus();
    return () => { element?.close(); };
  }, []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError(null);
    setRepositories([]);
    async function load() {
      const init = await rpc.call('init', {});
      if (!live) return;
      setRoot(init.defaultRoot);
      setExisting(init.existing);
      for (let page = 1; live; page++) {
        const result = await rpc.call('list', { page });
        if (!live) return;
        if (!result.ok) throw new Error(result.message);
        setRepositories(current => {
          const seen = new Set(current.map(repo => repo.fullName.toLowerCase()));
          return [...current, ...result.repositories.filter(repo => !seen.has(repo.fullName.toLowerCase()))];
        });
        if (!result.hasMore) { setLoading(false); return; }
      }
    }
    void load().catch(cause => { if (live) { setLoading(false); setLoadError(message(cause)); } });
    return () => { live = false; };
  }, [rpc, attempt]);

  const pasted = parseRepository(query);
  const needle = query.trim().toLowerCase();
  const matches = repositories.filter(repo => `${repo.fullName} ${repo.description}`.toLowerCase().includes(needle));
  if (pasted && !matches.some(repo => repo.fullName.toLowerCase() === pasted)) {
    matches.unshift({ fullName: pasted, description: 'Pasted repository. Access is checked when cloning.', visibility: '' });
  }
  const visible = matches.slice(0, 100);
  const active = visible.find(repo => repo.fullName === highlighted) ?? visible[0];
  const registered = existing.find(project => project.repository.toLowerCase() === selected?.toLowerCase() && project.path === destination);
  const canOpen = selected !== null && destination.trim() !== '' && root !== '' && !busy;
  const retryOpening = operation.kind === 'error' && operation.stage === 'register';

  function dismiss() {
    if (busy) return;
    close();
    if (request.returnFocus?.isConnected) request.returnFocus.focus();
  }
  useEffect(() => {
    if (focusDestination.current) { destinationInput.current?.focus(); focusDestination.current = false; }
  }, [selected]);
  function select(repo: Repository, focus = false) {
    if (focus) {
      if (destinationInput.current) destinationInput.current.focus();
      else focusDestination.current = true;
    }
    const project = existing.find(candidate => candidate.repository.toLowerCase() === repo.fullName.toLowerCase());
    setSelected(repo.fullName);
    setHighlighted(repo.fullName);
    setDestination(project?.path ?? `${root}/${repo.fullName.split('/')[1]}`);
    setOperation({ kind: 'idle' });
  }
  function keyboard(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
    if (event.target !== search.current || busy) return;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && visible.length) {
      event.preventDefault();
      const index = visible.findIndex(repo => repo.fullName === active?.fullName);
      const next = visible[(index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length];
      if (next) setHighlighted(next.fullName);
    } else if (event.key === 'Enter' && active) {
      event.preventDefault(); select(active, true);
    }
  }
  function waitForProject(projectId: string): Promise<void> {
    if (latestSidebar.current.projects.some(project => project.id === projectId)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        projectWaiters.current.delete(check);
        lifetime.current.signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      const check = () => { if (latestSidebar.current.projects.some(project => project.id === projectId)) finish(); };
      const abort = () => finish(new Error('The clone dialog closed before the project became available.'));
      const timer = setTimeout(() => finish(new Error('BB has not refreshed its project list. Your prompt is kept. Try opening again.')), 10_000);
      projectWaiters.current.add(check);
      lifetime.current.signal.addEventListener('abort', abort, { once: true });
      check();
    });
  }
  async function open() {
    if (!canOpen || !selected) return;
    setOperation({ kind: 'busy', stage: 'checkout' });
    let projectId: string;
    try {
      const result = await rpc.call('open', { repository: selected, destination });
      if (!mounted.current) return;
      if (!result.ok) {
        if (result.path) setDestination(result.path);
        setOperation({ kind: 'error', stage: result.stage, message: result.message });
        return;
      }
      projectId = result.projectId;
    } catch (cause) {
      if (mounted.current) setOperation({ kind: 'error', stage: 'clone', message: message(cause) });
      return;
    }
    try {
      setOperation({ kind: 'busy', stage: 'project' });
      await waitForProject(projectId);
      if (!mounted.current) return;
      setOperation({ kind: 'busy', stage: 'composer' });
      if (source) {
        const selection = await source.setSelection({ projectId });
        if (selection.projectId !== projectId) throw new Error('BB did not switch the draft to this project. Your prompt is kept. Try opening again.');
        const current = latestComposers.current.find(composer => composer.key === source.key) ?? source;
        close();
        current.focus();
      } else {
        close();
        navigate.toCompose({ projectId, focusPrompt: true });
      }
    } catch (cause) {
      if (mounted.current) setOperation({ kind: 'error', stage: 'composer', message: `Project ready. ${message(cause)}` });
    }
  }

  return <dialog ref={dialog} className="clone-dialog" aria-label="Clone repository" onCancel={event => { event.preventDefault(); dismiss(); }} onKeyDown={keyboard}>
    <header className="clone-header"><h2>Clone repository</h2><button type="button" onClick={dismiss} disabled={busy} aria-label="Close clone repository">Close <kbd>esc</kbd></button></header>
    <label className="clone-search">Repository<input ref={search} type="search" value={query} disabled={busy} aria-label="Find a repository"
      placeholder="Search your repositories or paste owner/repo" role="combobox" aria-expanded={true} aria-controls={listId}
      aria-activedescendant={active ? `${listId}-${visible.indexOf(active)}` : undefined}
      onChange={event => { setQuery(event.target.value); setHighlighted(null); }} /></label>
    <div className="clone-content">
      <div className="clone-results" id={listId} role="listbox" aria-label="Repositories">
        {visible.map((repo, index) => {
          const project = existing.find(candidate => candidate.repository.toLowerCase() === repo.fullName.toLowerCase());
          return <button type="button" role="option" aria-label={repo.fullName} aria-selected={selected === repo.fullName} key={repo.fullName}
            id={`${listId}-${index}`} data-active={active?.fullName === repo.fullName || undefined} disabled={busy} tabIndex={active?.fullName === repo.fullName ? 0 : -1}
            onFocus={() => setHighlighted(repo.fullName)} onClick={() => select(repo)}>
            <span className="clone-repository-name">{repo.fullName}</span><small>{project ? 'Open existing project' : repo.visibility}</small>
            {repo.description && <span className="clone-description">{repo.description}</span>}
          </button>;
        })}
        {visible.length === 0 && <p className="clone-empty">{loading ? 'Loading your repositories…' : 'No matches. Paste owner/repo to open a repository directly.'}</p>}
      </div>
      <section className="clone-destination" aria-label="Clone destination">
        {selected ? <>
          <h3>{selected}</h3>
          <label>Destination<input ref={destinationInput} aria-label="Destination" value={destination} disabled={busy}
            onChange={event => { setDestination(event.target.value); setOperation({ kind: 'idle' }); }} /></label>
          <p>{registered ? 'Use the existing project on this Mac.' : 'On this Mac. Choose a subfolder or edit the suggested path.'}</p>
          <button type="button" className="clone-primary" disabled={!canOpen} onClick={() => { void open(); }}>
            {busy ? 'Opening repository…' : retryOpening ? 'Retry opening' : registered ? 'Open existing project' : 'Clone and open'}
          </button>
          <p className="clone-draft-note">{source ? 'Your prompt stays in this draft. Its project changes after opening.' : 'Opens a new-thread composer. No prompt is sent.'}</p>
        </> : <p className="clone-empty">Select a repository to check its destination.</p>}
        {operation.kind === 'busy' && <p role="status">{operation.stage === 'checkout' ? 'Cloning or opening the checkout, then creating its BB project…'
          : operation.stage === 'project' ? 'Waiting for BB’s project list…' : 'Switching the composer to this project…'}</p>}
        {operation.kind === 'error' && <div role="alert"><p>{operation.message}</p>{retryOpening && <p>The checkout is kept. Retry opening without cloning again.</p>}</div>}
      </section>
    </div>
    <footer className="clone-footer">
      <span role="status">{loading ? `Searching ${repositories.length} loaded repositories. Loading more…`
        : loadError ? `Search covers ${repositories.length} loaded repositories.` : `${repositories.length} repositories loaded.`}
        {matches.length > visible.length ? ' Showing the first 100 matches. Refine your search.' : ''}</span>
      {loadError && <div role="alert"><span>{loadError}</span><button type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Retry loading</button></div>}
    </footer>
  </dialog>;
}

function Overlay() {
  useEffect(() => () => { launched = null; }, []);
  const request = useSyncExternalStore(subscribe, () => launched);
  return request ? <Picker request={request} /> : null;
}
export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'clone-repository', component: Overlay });
  app.commands.register({ id: 'open', title: 'Clone repository…', defaultShortcut: { key: 'c', alt: true }, run: ({ projectId, threadId }) => launch({ projectId, threadId }) });
  app.composer.customize({ id: 'clone-repository', scopes: ['new-thread'], plusMenu: [{
    id: 'open', label: 'Clone repository…', icon: 'GitFork',
    run: ({ composer }) => launch({ composer, projectId: composer.scope.kind === 'new-thread' ? composer.scope.projectId : null, threadId: null }),
  }] });
});
