import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { definePluginApp, useComposer, useComposers, useRpc, useSdk, useRealtime,
  experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import type { PluginComposerApi } from '@get-bb/plugin-sdk/app';
import { toast } from 'sonner';
import type { Favourite, rpcContract } from './contracts.ts';
import { createController, type Controller } from './controller.ts';
import { createProfileClient, type ProfileState } from './profiles.ts';
import { availability, capture, matches } from './favourites.ts';
import './picker.css';

const controllers = new Map<string, Controller>();
const listeners = new Set<() => void>();
let opened: string | null = null;
function open(composer: PluginComposerApi) { opened = composer.key; listeners.forEach(listener => listener()); }
function close() { opened = null; listeners.forEach(listener => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not update the model picker.';

function useController(composer: PluginComposerApi) {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  return useMemo(() => createController(composer, sdk, rpc), [composer, sdk, rpc]);
}
function CommandOwner() {
  const composer = useComposer();
  const controller = useController(composer);
  useEffect(() => {
    controllers.set(composer.key, controller);
    return () => { if (controllers.get(composer.key) === controller) controllers.delete(composer.key); };
  }, [composer, controller]);
  return null;
}
function Trigger() {
  const composer = useComposer();
  return <button type="button" className="mf-trigger" aria-label="Switch model" title="Switch model" onClick={() => open(composer)}>
    <Icon name="Star" className="size-4" /><Icon name="ChevronDown" className="size-3" />
  </button>;
}
function Overlay() {
  const key = useSyncExternalStore(subscribe, () => opened);
  const composers = useComposers();
  const composer = composers.find(candidate => candidate.key === key);
  useEffect(() => { if (key && !composer) close(); }, [key, composer]);
  return composer ? <ModelPicker key={composer.key} composer={composer} onClose={() => { close(); composer.focus(); }} /> : null;
}

export function ModelPicker({ composer, onClose }: { composer: PluginComposerApi; onClose: () => void }) {
  const sdk = useSdk();
  const ownController = useController(composer);
  const controller = controllers.get(composer.key) ?? ownController;
  const rpc = useRpc<typeof rpcContract>();
  const profileClient = useMemo(() => createProfileClient(sdk), [sdk]);
  const [list, setList] = useState<Favourite[]>([]);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<Controller['catalog']>>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [profiles, setProfiles] = useState<ProfileState | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const threadId = composer.scope.kind === 'thread' ? composer.scope.threadId : null;
  const claude = composer.selection?.providerId === 'claude-code';
  const currentProvider = composer.selection?.providerId;
  const environmentKey = JSON.stringify(composer.selection?.environment);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const [saved, available] = await Promise.all([rpc.call('list', {}), controller.catalog()]);
      if (current !== generation.current) return;
      setList(saved); setCatalog(available);
    } catch (cause) { if (current === generation.current) setError(message(cause)); }
    finally { if (current === generation.current) setLoading(false); }
  }, [rpc, controller]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh, currentProvider, environmentKey]);
  useRealtime('changed', () => { void refresh(); });
  const loadProfiles = useCallback(async () => {
    if (!claude || !threadId) return;
    setProfilesLoading(true); setProfileError(null);
    try { setProfiles(await profileClient.list(threadId)); }
    catch (cause) { setProfileError(message(cause)); }
    finally { setProfilesLoading(false); }
  }, [claude, threadId, profileClient]);
  useEffect(() => {
    let disposed = false;
    setProfiles(null); setProfileError(null);
    if (!claude || !threadId) return;
    setProfilesLoading(true);
    profileClient.list(threadId).then(value => { if (!disposed) setProfiles(value); }, cause => {
      if (!disposed) setProfileError(message(cause));
    }).finally(() => { if (!disposed) setProfilesLoading(false); });
    return () => { disposed = true; };
  }, [claude, threadId, profileClient]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal(); searchInput.current?.focus();
    return () => { element.close(); };
  }, []);
  async function run(work: () => Promise<unknown>, reload = false) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null);
    try { await work(); if (reload) await refresh(); }
    catch (cause) { setError(message(cause)); }
    finally { working.current = false; setBusy(false); }
  }
  function choose(favourite: Favourite) { void run(async () => { await controller.apply(favourite); onClose(); }); }
  const providerName = (id: string) => catalog.find(p => p.providerId === id)?.providerName ?? id;
  const modelName = (id: string, model: string) => catalog.find(p => p.providerId === id)?.models.find(m => m.model === model)?.displayName ?? model;
  const search = query.trim().toLowerCase();
  const visible = (providerId: string, text: string) => (filter === 'all' || filter === 'favourites' || filter === providerId) && text.toLowerCase().includes(search);
  // One starred model has one row, regardless of effort, tier or account.
  const favourites = list.filter((f, index) => list.findIndex(other => matches(other, f)) === index)
    .filter(f => visible(f.providerId, `${modelName(f.providerId, f.model)} ${providerName(f.providerId)} ${f.model}`));
  const groups = filter === 'favourites' ? [] : catalog.filter(p => filter === 'all' || filter === p.providerId).map(p => ({ ...p,
    models: p.models.filter(m => !list.some(f => f.providerId === p.providerId && f.model === m.model) && visible(p.providerId, `${m.displayName} ${m.model} ${p.providerName}`)),
  }));
  const currentCatalog = catalog.find(p => p.providerId === currentProvider);
  const currentModel = currentCatalog?.models.find(m => m.model === composer.selection?.model);
  const hasResults = favourites.length > 0 || groups.some(p => p.models.length > 0 || p.error);
  function keyboard(event: React.KeyboardEvent<HTMLDialogElement>) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.target instanceof HTMLSelectElement || event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.key === 'q' || event.key === 'Q') && !(event.defaultPrevented || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')))) {
      event.preventDefault(); if (!working.current) onClose();
    } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>('[data-model]:not(:disabled)')?.click();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('[data-model]:not(:disabled)') ?? []);
      const current = rows.findIndex(row => row === document.activeElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = rows[current < 0 ? (step === 1 ? 0 : rows.length - 1) : (current + step + rows.length) % rows.length];
      next?.focus(); next?.scrollIntoView?.({ block: 'nearest' });
    } else if ((!(event.target instanceof HTMLInputElement) || query === '') && /^[1-9]$/.test(event.key)) {
      const favourite = list.find(f => f.slot === Number(event.key));
      if (favourite && !loading && !busy) { event.preventDefault(); choose(favourite); }
    }
  }
  function row(favourite: Favourite, saved: boolean, reason: string | null = null) {
    const selected = matches(favourite, composer.selection);
    const name = modelName(favourite.providerId, favourite.model);
    return <div className="mf-row" key={favourite.id} data-selected={selected || undefined}>
      <button type="button" data-model className="mf-select" disabled={busy || loading || Boolean(reason)}
        aria-label={`Select ${name}`} aria-pressed={selected} onClick={() => choose(favourite)}>
        <span className="mf-model-name">{name}</span><span className="mf-detail">{reason ?? providerName(favourite.providerId)}</span>
      </button>
      {selected && <Icon name="Check" className="mf-check" />}
      {saved && <kbd className="mf-kbd">{favourite.slot}</kbd>}
      <button type="button" className="mf-star" data-saved={saved} aria-label={`${saved ? 'Unfavourite' : 'Favourite'} ${name}`} aria-pressed={saved}
        title={saved ? 'Remove favourite' : list.length >= 9 ? 'Nine favourites saved. Remove one to make space.' : 'Favourite model'}
        disabled={busy || loading || (!saved && (list.length >= 9 || Boolean(reason)))} onClick={() => { void run(async () => {
          if (saved) {
            for (const duplicate of list.filter(f => matches(f, favourite))) await rpc.call('remove', { id: duplicate.id });
          } else await rpc.call('add', { name: '', ...capture(favourite) });
        }, true); }}><Icon name="Star" className="mf-star-icon" /></button>
    </div>;
  }
  async function changeOption(field: 'reasoningLevel' | 'serviceTier', value: string) {
    const selection = { providerId: composer.selection?.providerId, model: composer.selection?.model, [field]: value };
    const settled = await composer.setSelection(selection);
    if (settled[field] !== value) throw new Error('This option is unavailable for the current model.');
  }
  return <dialog ref={dialog} className="mf-dialog" aria-label="Switch model" onKeyDown={keyboard}
    onCancel={event => { event.preventDefault(); if (!working.current) onClose(); }}
    onPointerDown={event => { if (event.target === event.currentTarget && !working.current) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    } }}>
    <div className="mf-picker">
      <div className="mf-search"><Icon name="Search" className="mf-search-icon" />
        <input ref={searchInput} aria-label="Search models" placeholder="Search any model or provider…" value={query} onChange={event => setQuery(event.target.value)} />
        <button type="button" className="mf-dismiss" aria-label="Close model switcher" disabled={busy} onClick={onClose}><kbd className="mf-kbd">esc</kbd></button>
      </div>
      <div className="mf-body">
        <nav className="mf-nav" aria-label="Filter models">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All models</button>
          <button type="button" aria-pressed={filter === 'favourites'} onClick={() => setFilter('favourites')}><Icon name="Star" className="size-3 mf-gold" />Favourites<span className="mf-count">{list.length}</span></button>
          <div className="mf-divider" />
          {catalog.map(p => <button type="button" key={p.providerId} aria-pressed={filter === p.providerId} onClick={() => setFilter(p.providerId)}>{p.providerName}</button>)}
        </nav>
        <div className="mf-content">
          {error && <div role="alert" className="mf-error">{error} <button type="button" disabled={busy} onClick={() => { setError(null); void refresh(); }}>Retry</button></div>}
          <div className="mf-list" aria-label="Models" aria-busy={loading || busy}>
            {loading && <p role="status" className="mf-empty">Loading models…</p>}
            {!loading && !hasResults && <div className="mf-empty">{filter === 'favourites' && !query ? 'Star a model to keep it here.' : 'No models found.'}<br /><span>{filter === 'favourites' && !query ? 'Browse All models to choose your favourites.' : 'Try another name or provider.'}</span></div>}
            {favourites.length > 0 && <section aria-label="Favourites"><div className="mf-section">Favourites <span>{list.length}/9</span></div>
              {favourites.map(f => {
                const providerCatalog = catalog.find(p => p.providerId === f.providerId);
                return row(f, true, providerCatalog ? availability(capture(f), { available: true, error: providerCatalog.error, models: providerCatalog.models }) : 'Provider unavailable on this machine');
              })}</section>}
            {groups.map(p => (p.models.length > 0 || p.error) && <section key={p.providerId} aria-label={p.providerName}>
              <div className="mf-section">{p.providerName}</div>
              {p.error ? <p className="mf-empty">{p.error}</p> : p.models.map(m => row({ id: `${p.providerId}:${m.model}`, slot: 1, name: '', providerId: p.providerId, model: m.model }, false))}
            </section>)}
          </div>
        </div>
      </div>
      <div className="mf-settings">
        <div className="mf-current"><span>{composer.selection?.model ? modelName(currentProvider ?? '', composer.selection.model) : 'Choose a model'}</span><small>{currentProvider ? providerName(currentProvider) : ''} · current selection</small></div>
        <div className="mf-options">
          {currentModel && currentModel.supportedReasoningEfforts.length > 0 && <label>Effort<select aria-label="Reasoning effort" disabled={busy || loading} value={composer.selection?.reasoningLevel ?? currentModel.defaultReasoningEffort}
            onChange={event => { void run(() => changeOption('reasoningLevel', event.target.value)); }}>
            {currentModel.supportedReasoningEfforts.map(e => <option key={e.reasoningEffort} value={e.reasoningEffort}>{e.reasoningEffort}</option>)}
          </select></label>}
          {currentModel && (currentModel.supportedServiceTiers?.length ?? 0) > 0 && <label>Tier<select aria-label="Service tier" disabled={busy || loading} value={composer.selection?.serviceTier ?? 'default'}
            onChange={event => { void run(() => changeOption('serviceTier', event.target.value)); }}>
            <option value="default">Default</option>{currentModel.supportedServiceTiers?.filter(t => t.id !== 'default').map(t => <option key={t.id} value={t.id}>{t.label ?? t.id}</option>)}
          </select></label>}
        </div>
      </div>
      {claude && <div className="mf-account">
        <Icon name="Users" className="size-4" />
        {threadId && profiles?.supported ? <label>Claude account<select aria-label="Claude account" value={profiles.selection?.profile.id ?? ''}
          disabled={busy || profilesLoading || composer.isRunning || composer.isSubmitting} onChange={event => { const id = event.target.value;
            if (!id) return; void run(async () => {
              const selection = await profileClient.switch(threadId, id);
              setProfiles(previous => previous ? { ...previous, selection } : previous);
              await refresh();
            }); }}>
          {!profiles.selection && <option value="">Native login</option>}
          {profiles.profiles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select></label> : <span>{profilesLoading ? 'Loading Claude accounts…' : profileError ?? 'Choose an account after the first message.'}</span>}
        {threadId && <button type="button" className="mf-refresh" aria-label="Refresh Claude accounts" disabled={busy || profilesLoading} onClick={() => { void loadProfiles(); }}><Icon name="RefreshCw" className="size-3" /></button>}
        {profiles?.supported && composer.isRunning && <small>Available when this turn finishes.</small>}
        {profiles?.supported && profileError && <small role="alert">{profileError}</small>}
      </div>}
      <div className="mf-footer"><span><kbd className="mf-kbd">↑</kbd><kbd className="mf-kbd">↓</kbd> Navigate</span><span><kbd className="mf-kbd">↵</kbd> Select</span><span><kbd className="mf-kbd">1-9</kbd> Favourites</span><span>★ Save model</span></div>
    </div>
  </dialog>;
}

async function command(composer: PluginComposerApi, work: (controller: Controller) => Promise<void>) {
  const controller = controllers.get(composer.key);
  if (!controller) { open(composer); return; }
  try { await work(controller); }
  catch (cause) { toast.error(message(cause)); }
}
export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'model-picker', component: Overlay });
  app.composer.customize({ id: 'model-favourites', scopes: ['thread', 'new-thread'],
    banners: [{ id: 'command-owner', chrome: 'bare', component: CommandOwner }],
    actions: [{ id: 'open', component: Trigger }],
    plusMenu: [{ id: 'open', label: 'Switch model', icon: 'Star', run: ({ composer }) => open(composer) }],
  });
  app.composer.experimental_registerCommand({ id: 'open', title: 'Model favourites: Open switcher', defaultShortcut: { key: 'f', alt: true }, run: ({ composer }) => open(composer) });
  app.composer.experimental_registerCommand({ id: 'next', title: 'Model favourites: Next favourite', defaultShortcut: { key: 'f', alt: true, shift: true }, run: ({ composer }) => command(composer, controller => controller.cycle(1)) });
  app.composer.experimental_registerCommand({ id: 'previous', title: 'Model favourites: Previous favourite', run: ({ composer }) => command(composer, controller => controller.cycle(-1)) });
  for (let slot = 1; slot <= 9; slot++) app.composer.experimental_registerCommand({ id: `select-${slot}`, title: `Model favourites: Select favourite ${slot}`,
    run: ({ composer }) => command(composer, controller => controller.select(slot)) });
});
