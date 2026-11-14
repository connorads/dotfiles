import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useComposer, useComposers, useRealtime, useRpc, useSdk } from '@get-bb/plugin-sdk/app';
import type { PluginComposerApi } from '@get-bb/plugin-sdk/app';
import { toast } from 'sonner';
import type { KeyedProfile, rpcContract } from '../../contracts.ts';
import type { Usage } from '../../src/accounts/quota.ts';
import type { Effort, Favourite, Setup } from '../../src/models/contract.ts';
import { createController, type Controller } from './controller.ts';
import { close, open, openedState, subscribe } from './store.ts';
import { accountChips, modelOf, quickRows, ring, searchGroups, stepEffort, type AccountChip, type ProviderCatalog, type Result, type Row } from './view.ts';
import './switcher.css';

type Accounts = { supported: boolean; profiles: KeyedProfile[]; currentId: string; pendingId: string | null };
const controllers = new Map<string, Controller>();
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not update the selection.';
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('input, textarea, select'));

export function useController(composer: PluginComposerApi) {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  return useMemo(() => createController(composer, sdk, rpc), [composer, sdk, rpc]);
}

// Each composer registers its controller so shortcuts work while the switcher is closed.
export function CommandOwner() {
  const composer = useComposer();
  const controller = useController(composer);
  useEffect(() => {
    controllers.set(composer.key, controller);
    return () => { if (controllers.get(composer.key) === controller) controllers.delete(composer.key); };
  }, [composer, controller]);
  return null;
}

export async function command(composer: PluginComposerApi, work: (controller: Controller) => Promise<void>) {
  const controller = controllers.get(composer.key);
  if (!controller) { open(composer); return; }
  try { await work(controller); }
  catch (cause) { toast.error(message(cause)); }
}

export function Overlay() {
  const opened = useSyncExternalStore(subscribe, openedState);
  const composers = useComposers();
  const composer = composers.find(candidate => candidate.key === opened?.key);
  useEffect(() => { if (opened && !composer) close(); }, [opened, composer]);
  if (!composer) return null;
  return <Switcher key={composer.key} composer={composer} onClose={() => { close(); composer.focus(); }} />;
}

const GLYPHS: Record<string, string> = { 'claude-code': '✳', codex: '◎', 'acp-opencode': 'O', pi: 'π' };
export function Glyph({ providerId }: { providerId: string }) {
  return <span className="sw-glyph" data-provider={providerId} aria-hidden="true">{GLYPHS[providerId] ?? providerId.charAt(0).toUpperCase()}</span>;
}
function Dots({ levels, effort }: { levels: readonly Effort[]; effort: Effort | null }) {
  if (!levels.length) return null;
  if (!effort) return <span className="sw-auto">auto</span>;
  const filled = levels.indexOf(effort) + 1;
  return <span className="sw-dots" title={effort} aria-label={`Effort ${effort}`}>{levels.map((level, index) => <i key={level} data-on={index < filled || undefined} />)}</span>;
}
function PlugIcon() {
  return <svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M6 1.5v3M10 1.5v3M4 4.5h8v3a4 4 0 0 1-8 0zM8 11.5v3" /></svg>;
}
export function AccountBadge({ chip, usage }: { chip: Pick<AccountChip, 'profile'>; usage?: Usage }) {
  const view = ring(usage);
  const r = 13, length = 2 * Math.PI * r;
  return <span className="sw-ring" data-tone={view.tone} title={`${chip.profile.label} · ${view.label}`}>
    <svg viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r={r} className="sw-ring-track" />
      {view.percent !== null && <circle cx="15" cy="15" r={r} className="sw-ring-fill" strokeDasharray={`${length * Math.min(100, view.percent) / 100} ${length}`} />}</svg>
    <span className="sw-key" data-account={chip.profile.id}>{chip.profile.key ?? '?'}</span>
  </span>;
}

export function Switcher({ composer, onClose }: { composer: PluginComposerApi; onClose: () => void }) {
  const own = useController(composer);
  const controller = controllers.get(composer.key) ?? own;
  const rpc = useRpc<typeof rpcContract>();
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  const [view, setView] = useState<'quick' | 'search'>('quick');
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [catalog, setCatalog] = useState<ProviderCatalog[]>([]);
  const [daybreak, setDaybreak] = useState<boolean | undefined>();
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [quotas, setQuotas] = useState<Record<string, Usage>>({});
  const [connectors, setConnectors] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadId = composer.scope.kind === 'thread' ? composer.scope.threadId : null;
  const providerId = composer.selection?.providerId;
  const generation = useRef(0);

  const loadModels = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [saved, available, programme] = await Promise.all([rpc.call('favourites.list', {}), controller.catalog(), controller.daybreak()]);
      if (request !== generation.current) return;
      setFavourites(saved); setCatalog(available as ProviderCatalog[]); setDaybreak(programme);
    } catch (cause) { if (request === generation.current) setError(message(cause)); }
    finally { if (request === generation.current) setLoading(false); }
  }, [rpc, controller]);
  useEffect(() => { void loadModels(); }, [loadModels, providerId, composer.selection?.model]);
  useRealtime('favourites-changed', () => { void loadModels(); });

  const accountGeneration = useRef(0);
  const loadAccounts = useCallback(async () => {
    const request = ++accountGeneration.current;
    if (providerId !== 'claude-code') { setAccounts(null); return; }
    try {
      const value = await rpc.call('accounts', { threadId });
      if (request !== accountGeneration.current) return;
      setAccounts(value);
      void rpc.call('connectors.get', { threadId }).then(state => { if (request === accountGeneration.current) setConnectors(state.accounts); }, () => {});
      for (const profile of value.profiles) {
        const reading = threadId === null ? rpc.call('nextThreadQuota', { profileId: profile.id }) : rpc.call('usage', { threadId, profileId: profile.id, refresh: false });
        void reading.then(usage => { if (request === accountGeneration.current) setQuotas(previous => ({ ...previous, [profile.id]: usage })); }, () => {});
      }
    } catch (cause) { if (request === accountGeneration.current) setError(message(cause)); }
  }, [rpc, threadId, providerId]);
  useEffect(() => { void loadAccounts(); }, [loadAccounts, composer.isRunning]);
  useRealtime('profiles-changed', () => { void loadAccounts(); });

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal?.();
    element.focus();
    return () => { element.close?.(); };
  }, []);
  useEffect(() => { if (view === 'search') search.current?.focus(); else dialog.current?.focus(); }, [view]);

  async function run(work: () => Promise<unknown>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null);
    try { await work(); }
    catch (cause) { setError(message(cause)); }
    finally { working.current = false; setBusy(false); }
  }

  const current = { providerId, model: composer.selection?.model, reasoningLevel: composer.selection?.reasoningLevel,
    serviceTier: composer.selection?.serviceTier, daybreak };
  const rows = quickRows(favourites, catalog, current, setup => controller.scopeReason(setup));
  const currentRow = rows.find(row => row.selected);
  const currentFavourite = favourites.find(f => f.id === currentRow?.id);
  const currentModel = modelOf(catalog, providerId, composer.selection?.model);
  const groups = searchGroups(catalog, favourites, query, id => composer.scope.kind === 'thread' && id === providerId);
  const results = groups.flatMap(group => group.results);
  const chips = accounts?.supported ? accountChips(providerId, accounts, connectors) : [];
  const tiers = (currentModel?.supportedServiceTiers ?? []).filter(tier => tier.id !== 'default');
  const daybreakOption = currentModel?.sessionOptions?.find(option => option.id === 'daybreak' && option.type === 'boolean');

  // Daybreak can change without a model change, so every apply re-reads it.
  const apply = (setup: Setup) => run(async () => { await controller.apply(setup); await loadModels(); });
  const chooseAccount = (profile: KeyedProfile) => run(async () => {
    const { currentId } = await rpc.call('choose', { threadId, profileId: profile.id });
    await loadAccounts();
    if (currentId !== profile.id && threadId !== null) toast(`${profile.label} from the next turn`);
  });
  const star = (setup: Setup, saved: Favourite | undefined) => run(async () => {
    if (saved) await rpc.call('favourites.remove', { id: saved.id });
    else {
      const live = setup.providerId === providerId && setup.model === composer.selection?.model;
      await rpc.call('favourites.add', { name: '', providerId: setup.providerId, model: setup.model,
        ...(setup.daybreak !== undefined ? { daybreak: setup.daybreak } : {}),
        ...(live && current.reasoningLevel ? { reasoningLevel: current.reasoningLevel } : {}) });
    }
    await loadModels();
  });
  const changeEffort = (direction: -1 | 1) => {
    if (!currentModel || !providerId) return;
    const levels = currentModel.supportedReasoningEfforts.map(e => e.reasoningEffort);
    const next = stepEffort(levels, current.reasoningLevel ?? null, direction, currentModel.defaultReasoningEffort);
    if (!next || next === current.reasoningLevel) return;
    void run(async () => {
      await composer.setSelection({ providerId, model: currentModel.model, reasoningLevel: next });
      if (currentFavourite) await rpc.call('favourites.remember', { id: currentFavourite.id, reasoningLevel: next });
    });
  };
  const toggleFast = () => {
    if (!currentModel || !providerId || !tiers.length) return;
    const tier = composer.selection?.serviceTier && composer.selection.serviceTier !== 'default' ? 'default' : tiers[0]!.id;
    void run(async () => {
      await composer.setSelection({ providerId, model: currentModel.model, serviceTier: tier });
      if (currentFavourite) await rpc.call('favourites.remember', { id: currentFavourite.id, serviceTier: tier === 'default' ? null : tier });
    });
  };
  const toggleDaybreak = () => {
    if (!currentModel || !providerId || !daybreakOption || daybreakOption.fixed) return;
    void run(async () => { await controller.apply({ providerId, model: currentModel.model, daybreak: !daybreak }); await loadModels(); });
  };

  function keyboard(event: React.KeyboardEvent<HTMLDialogElement>) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    const { key } = event;
    if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 's') {
      event.preventDefault();
      if (view === 'search') { const result = results[highlight]; if (result) void star(result.setup, favourites.find(f => f.slot === result.slot)); }
      else if (currentRow) void star(currentRow.setup, currentFavourite);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (key === 'Escape') {
      event.preventDefault();
      if (view === 'search') { setView('quick'); setQuery(''); } else if (!working.current) onClose();
      return;
    }
    if (view === 'search') {
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        setHighlight(index => results.length ? (index + (key === 'ArrowDown' ? 1 : results.length - 1)) % results.length : 0);
      } else if (key === 'Enter') {
        event.preventDefault();
        const result = results[highlight];
        if (result) void run(async () => { await controller.apply(result.setup); await loadModels(); setView('quick'); setQuery(''); });
      }
      return;
    }
    if (isTyping(event.target)) return;
    if (key === 'Enter') { event.preventDefault(); if (!working.current) onClose(); }
    else if (key === '/') { event.preventDefault(); setView('search'); setHighlight(0); }
    else if (key === 'ArrowLeft' || key === 'ArrowRight') { event.preventDefault(); changeEffort(key === 'ArrowLeft' ? -1 : 1); }
    else if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
      const slotted = rows.filter(row => row.slot !== null && !row.reason);
      const index = slotted.findIndex(row => row.selected);
      const next = index === -1 ? slotted[key === 'ArrowDown' ? 0 : slotted.length - 1]
        : slotted[(index + (key === 'ArrowDown' ? 1 : slotted.length - 1)) % slotted.length];
      if (next) void apply(next.setup);
    } else if (/^[1-9]$/.test(key)) {
      const row = rows.find(candidate => candidate.slot === Number(key));
      if (row && !row.reason) { event.preventDefault(); void apply(row.setup); }
    } else if (/^[a-z]$/i.test(key) && chips.length) {
      const chip = chips.find(candidate => candidate.profile.key === key.toUpperCase());
      if (chip) { event.preventDefault(); if (!chip.selected) void chooseAccount(chip.profile); }
    }
  }

  function quickRow(row: Row) {
    return <li key={row.id} className="sw-row" data-selected={row.selected || undefined} data-unavailable={row.reason ? true : undefined}>
      <button type="button" className="sw-select" aria-current={row.selected || undefined} aria-disabled={Boolean(row.reason) || undefined}
        aria-label={`${row.slot ? `${row.slot}. ` : ''}${row.name}`} title={row.reason ?? row.provider}
        onClick={() => { if (!row.reason) void apply(row.setup); }}>
        <kbd className="sw-slot" aria-hidden="true">{row.slot ?? ''}</kbd>
        <Glyph providerId={row.providerId} />
        <span className="sw-name">{row.name}</span>
        {row.slot === null && <span className="sw-keep">⌘S to keep</span>}
      </button>
      {row.selected && tiers.length > 0 && <button type="button" className="sw-pill" aria-pressed={Boolean(composer.selection?.serviceTier && composer.selection.serviceTier !== 'default')} onClick={toggleFast}>Fast</button>}
      {row.selected && daybreakOption && !daybreakOption.fixed && composer.scope.kind === 'thread' && <button type="button" className="sw-pill" aria-pressed={Boolean(daybreak)} onClick={toggleDaybreak}>Daybreak</button>}
      <Dots levels={row.levels} effort={row.effort} />
      <span className="sw-check" aria-hidden="true">{row.selected ? '✓' : ''}</span>
    </li>;
  }
  function searchRow(result: Result, index: number) {
    const saved = favourites.find(f => f.slot === result.slot);
    return <li key={result.id} className="sw-row" data-highlight={index === highlight || undefined}>
      <button type="button" className="sw-select" aria-label={result.name} onMouseEnter={() => setHighlight(index)}
        onClick={() => { void run(async () => { await controller.apply(result.setup); await loadModels(); setView('quick'); setQuery(''); }); }}>
        <span className="sw-slot" aria-hidden="true" /><Glyph providerId={result.setup.providerId} />
        <span className="sw-name">{result.name}</span>
      </button>
      {result.slot !== null && <kbd className="sw-slot" aria-hidden="true">{result.slot}</kbd>}
      <button type="button" className="sw-star" aria-pressed={Boolean(saved)} aria-label={`${saved ? 'Unfavourite' : 'Favourite'} ${result.name}`}
        onClick={() => { void star(result.setup, saved); }}>{saved ? '★' : '☆'}</button>
    </li>;
  }

  const offset = (group: number) => groups.slice(0, group).reduce((total, g) => total + g.results.length, 0);
  return <dialog ref={dialog} tabIndex={-1} className="sw-dialog" aria-label="Switch model" aria-busy={busy || loading} onKeyDown={keyboard}
    onCancel={event => { event.preventDefault(); }}
    onPointerDown={event => { if (event.target === event.currentTarget && !working.current) onClose(); }}>
    {view === 'quick' ? <>
      {loading ? <p role="status" className="sw-empty">Loading…</p> : <ul className="sw-list" aria-label="Favourites">{rows.map(quickRow)}</ul>}
      {chips.length > 0 && <div className="sw-accounts" role="group" aria-label="Claude account">
        {chips.map(chip => <button type="button" key={chip.profile.id} className="sw-account" aria-pressed={chip.selected}
          aria-keyshortcuts={chip.profile.key ?? undefined} aria-label={`${chip.profile.label}${chip.pending ? ', next turn' : ''}${chip.connectors ? ', connectors on' : ''}`}
          onClick={() => { if (!chip.selected) void chooseAccount(chip.profile); }}>
          <AccountBadge chip={chip} usage={quotas[chip.profile.id]} />
          {chip.connectors && <span className="sw-plug" title="Connectors on" aria-hidden="true"><PlugIcon /></span>}
          <span className="sw-account-name">{chip.profile.label}</span>
          {chip.pending && <span className="sw-next">next turn</span>}
        </button>)}
      </div>}
      {providerId === 'claude-code' && accounts && !accounts.supported && <p className="sw-empty" role="status">
        Account choice opens after the first message. New Claude threads start on your remembered account.</p>}
      <button type="button" className="sw-search-row" aria-label="All models" aria-keyshortcuts="/" onClick={() => { setView('search'); setHighlight(0); }}>
        <span aria-hidden="true">⌕</span><span>All models</span><kbd>/</kbd></button>
    </> : <>
      <div className="sw-search"><span aria-hidden="true">⌕</span>
        <input ref={search} aria-label="Search models" placeholder="Search models" value={query} autoComplete="off" spellCheck={false}
          onChange={event => { setQuery(event.target.value); setHighlight(0); }} /></div>
      <div className="sw-results">
        {groups.map((group, groupIndex) => <section key={group.providerId} aria-label={group.provider}>
          <h3 className="sw-group">{group.provider}</h3>
          {group.error ? <p className="sw-empty" title={group.error}>Not available on this machine</p>
            : <ul className="sw-list">{group.results.map((result, index) => searchRow(result, offset(groupIndex) + index))}</ul>}
        </section>)}
        {!groups.length && <p className="sw-empty">No models match.</p>}
      </div>
      <div className="sw-foot" aria-hidden="true"><span><kbd>↵</kbd> use</span><span><kbd>⌘S</kbd> favourite</span><span><kbd>esc</kbd> back</span></div>
    </>}
    {error && <p role="alert" className="sw-error">{error}</p>}
  </dialog>;
}
