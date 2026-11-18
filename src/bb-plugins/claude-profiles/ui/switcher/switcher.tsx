import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useComposer, useComposers, useRealtime, useRpc, useSdk } from '@get-bb/plugin-sdk/app';
import type { PluginComposerApi } from '@get-bb/plugin-sdk/app';
import { toast } from 'sonner';
import type { KeyedProfile, rpcContract } from '../../contracts.ts';
import type { Usage } from '../../src/accounts/quota.ts';
import type { Effort, Favourite, Setup } from '../../src/models/contract.ts';
import { createController, type Controller } from './controller.ts';
import { close, open, openedState, reanchor, subscribe, type Anchor } from './store.ts';
import { accountChips, modelOf, placement, quickRows, ring, searchGroups, stepEffort, tierLabel, type AccountChip, type ProviderCatalog, type Result, type Row } from './view.ts';
import './switcher.css';
import { antigravityAccountId } from '../../src/accounts/antigravity-account.ts';
import { BrandIcon } from '../usage/brand-icon.tsx';

type Accounts = { supported: boolean; profiles: KeyedProfile[]; currentId: string; pendingId: string | null };
const controllers = new Map<string, Controller>();
// One change at a time per composer, across switcher instances: closing and reopening must not start a second change.
type Work = { done: Promise<void>; status: string; accountId: string | null };
const running = new Map<string, Work>();
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not update the selection.';
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('input, textarea, select'));
const isButton = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('button'));
// Touch and narrow phone screens get a full-width sheet at the bottom instead of a popover beside the chip.
const SHEET = '(pointer: coarse) and (max-width: 640px)';
function sheetChanges(listener: () => void) {
  const query = window.matchMedia?.(SHEET);
  query?.addEventListener('change', listener);
  return () => query?.removeEventListener('change', listener);
}

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
  const earlier = running.get(composer.key);
  if (earlier) { toast.error(`Wait for the current change to finish: ${earlier.status}`); return; }
  try { await work(controller); }
  catch (cause) { toast.error(message(cause)); }
}

export function Overlay() {
  const opened = useSyncExternalStore(subscribe, openedState);
  const composers = useComposers();
  const composer = composers.find(candidate => candidate.key === opened?.key);
  useEffect(() => { if (opened && !composer) close(); }, [opened, composer]);
  if (!composer) return null;
  return <Switcher key={composer.key} composer={composer} anchor={opened?.anchor ?? null} onClose={() => { close(); composer.focus(); }} />;
}

const GLYPHS: Record<string, string> = { 'claude-code': '✳', codex: '◎', 'acp-opencode': 'O', pi: 'π' };
export function Glyph({ providerId }: { providerId: string }) {
  if (antigravityAccountId(providerId) !== null) return <BrandIcon brand="antigravity" />;
  return <span className="sw-glyph" data-provider={providerId} aria-hidden="true">{GLYPHS[providerId] ?? providerId.charAt(0).toUpperCase()}</span>;
}
function Dots({ id, levels, effort }: { id: string; levels: readonly Effort[]; effort: Effort | null }) {
  if (!levels.length) return null;
  if (!effort) return <span id={id} className="sw-auto" aria-label="Effort auto">auto</span>;
  const filled = levels.indexOf(effort) + 1;
  return <span id={id} className="sw-dots" title={effort} aria-label={`Effort ${effort}`}>{levels.map((level, index) => <i key={level} data-on={index < filled || undefined} />)}</span>;
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

export function Switcher({ composer, onClose, anchor = null }: { composer: PluginComposerApi; onClose: () => void; anchor?: Anchor | null }) {
  const own = useController(composer);
  const controller = controllers.get(composer.key) ?? own;
  const rpc = useRpc<typeof rpcContract>();
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
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
  const [work, setWork] = useState<Work | null>(() => running.get(composer.key) ?? null);
  const [error, setError] = useState<string | null>(null);
  const threadId = composer.scope.kind === 'thread' ? composer.scope.threadId : null;
  const providerId = composer.selection?.providerId;
  const generation = useRef(0);
  const ids = useId();
  const sheet = useSyncExternalStore(sheetChanges, () => window.matchMedia?.(SHEET).matches ?? false);

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
    if (providerId && antigravityAccountId(providerId) !== null) {
      try {
        const hostId = await controller.hostId();
        const profiles = await rpc.call('antigravityAccounts', { hostId });
        if (request !== accountGeneration.current) return;
        setAccounts({ supported: true, profiles, currentId: providerId, pendingId: null });
        setConnectors({});
        for (const profile of profiles) void rpc.call('antigravityQuota', { hostId, providerId: profile.id }).then(usage => {
          if (request === accountGeneration.current) setQuotas(previous => ({ ...previous, [profile.id]: usage }));
        }, () => {});
      } catch (cause) { if (request === accountGeneration.current) setError(message(cause)); }
      return;
    }
    if (providerId !== 'claude-code') { setAccounts(null); return; }
    try {
      const value = await rpc.call('accounts', { threadId });
      if (request !== accountGeneration.current) return;
      setAccounts(value);
      void rpc.call('connectors.get', { threadId }).then(state => { if (request === accountGeneration.current) setConnectors(state.accounts); }, () => {});
      for (const profile of value.profiles) {
        const reading = threadId === null ? rpc.call('nextThreadQuota', { profileId: profile.id }) : rpc.call('usage', { threadId, profileId: profile.id, refresh: false });
        const settle = (usage: Usage) => { if (request === accountGeneration.current) setQuotas(previous => ({ ...previous, [profile.id]: usage })); };
        void reading.then(settle, () => settle({ status: 'error', windows: [], message: 'Usage unavailable', observedAt: null }));
      }
    } catch (cause) { if (request === accountGeneration.current) setError(message(cause)); }
  }, [rpc, threadId, providerId, controller]);
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
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // A resize moves the chip and changes the room beside it, so the anchored dialog re-measures both.
  useEffect(() => {
    window.addEventListener('resize', reanchor);
    return () => window.removeEventListener('resize', reanchor);
  }, []);

  // The switcher can close while work runs, so a late failure becomes a toast instead of a lost alert.
  async function run(task: () => Promise<unknown>, status = 'Applying…', accountId: string | null = null) {
    if (running.has(composer.key)) return;
    let finish = () => {};
    const entry: Work = { done: new Promise<void>(resolve => { finish = resolve; }), status, accountId };
    running.set(composer.key, entry); setWork(entry); setError(null);
    try { await task(); }
    catch (cause) { if (mounted.current) setError(message(cause)); else toast.error(message(cause)); }
    finally { running.delete(composer.key); finish(); if (mounted.current) setWork(null); }
  }
  // A switcher reopened while an earlier one's change runs waits for it, then shows its result.
  const adopted = useRef(work);
  useEffect(() => {
    const earlier = adopted.current;
    if (!earlier) return;
    let alive = true;
    void earlier.done.then(() => {
      if (!alive) return;
      adopted.current = null;
      setWork(current => current === earlier ? null : current);
      void loadAccounts(); void loadModels();
    });
    return () => { alive = false; };
  }, [loadAccounts, loadModels]);
  const busy = work !== null;

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
  const singleTier = tiers.length === 1 ? tiers[0] : undefined;
  const activeTier = current.serviceTier ?? 'default';
  const daybreakOption = currentModel?.sessionOptions?.find(option => option.id === 'daybreak' && option.type === 'boolean');

  // Daybreak can change without a model change, so every apply re-reads it.
  const apply = (setup: Setup) => run(async () => { await controller.apply(setup); await loadModels(); });
  const chooseAccount = (profile: KeyedProfile) => run(async () => {
    if (providerId && antigravityAccountId(providerId) !== null) {
      if (composer.isRunning) throw new Error('Finish or stop the turn before changing Antigravity accounts.');
      const model = composer.selection?.model;
      if (!model) throw new Error('Choose a model before changing accounts.');
      await controller.apply({ providerId: profile.id, model,
        ...(composer.selection?.reasoningLevel ? { reasoningLevel: composer.selection.reasoningLevel } : {}) });
      await loadModels();
      return;
    }
    const { currentId } = await rpc.call('choose', { threadId, profileId: profile.id });
    await loadAccounts();
    if (currentId !== profile.id && threadId !== null) toast(`${profile.label} from the next turn`);
  }, `Switching to ${profile.label}…`, profile.id);
  const star = (setup: Setup, saved: Favourite | undefined) => run(async () => {
    if (saved) await rpc.call('favourites.remove', { id: saved.id });
    else {
      const live = setup.providerId === providerId && setup.model === composer.selection?.model;
      await rpc.call('favourites.add', { name: '', providerId: setup.providerId, model: setup.model,
        ...(setup.daybreak !== undefined ? { daybreak: setup.daybreak } : {}),
        ...(live && current.reasoningLevel ? { reasoningLevel: current.reasoningLevel } : {}) });
    }
    await loadModels();
  }, 'Saving favourites…');
  // A dimmed favourite says why instead of ignoring the press; touch has no hover title.
  const pick = (row: Row) => { if (row.reason) setError(row.reason); else void apply(row.setup); };
  const efforts = currentModel?.supportedReasoningEfforts.map(e => e.reasoningEffort) ?? [];
  const changeEffort = (direction: -1 | 1) => {
    if (currentModel) setEffort(stepEffort(efforts, current.reasoningLevel ?? null, direction, currentModel.defaultReasoningEffort));
  };
  function setEffort(next: Effort | null) {
    if (!currentModel || !providerId || !next || next === current.reasoningLevel) return;
    void run(async () => {
      await composer.setSelection({ providerId, model: currentModel.model, reasoningLevel: next });
      if (currentFavourite) await rpc.call('favourites.remember', { id: currentFavourite.id, reasoningLevel: next });
    });
  }
  const setServiceTier = (tier: string) => {
    if (!currentModel || !providerId || tier === activeTier) return;
    void run(async () => {
      const settled = await composer.setSelection({ providerId, model: currentModel.model, serviceTier: tier });
      if (!settled || (settled.serviceTier ?? 'default') !== tier) {
        throw new Error('BB could not apply this speed. Check the current model before sending.');
      }
      if (currentFavourite) await rpc.call('favourites.remember', { id: currentFavourite.id, serviceTier: tier === 'default' ? null : tier });
    });
  };
  const toggleDaybreak = () => {
    if (!currentModel || !providerId || !daybreakOption || daybreakOption.fixed) return;
    // The programme change keeps the effort and tier already chosen.
    const kept = { ...(current.reasoningLevel ? { reasoningLevel: current.reasoningLevel } : {}), ...(current.serviceTier ? { serviceTier: current.serviceTier } : {}) };
    void run(async () => { await controller.apply({ providerId, model: currentModel.model, daybreak: !daybreak, ...kept }); await loadModels(); });
  };
  // The switch writes the same account preference as the settings section; the server's profiles-changed event refreshes both.
  const shownProfile = accounts?.supported ? accounts.profiles.find(profile => profile.id === (accounts.pendingId ?? accounts.currentId)) : undefined;
  const toggleConnectors = (profile: KeyedProfile) => {
    const next = connectors[profile.id] !== true;
    void run(async () => {
      await rpc.call('connectors.account.set', { threadId, profileId: profile.id, enabled: next });
      setConnectors(previous => ({ ...previous, [profile.id]: next }));
      await loadAccounts();
    }, 'Saving connectors…');
  };
  const openSearch = () => { setView('search'); setHighlight(0); };
  const closeSearch = () => { setView('quick'); setQuery(''); };

  // Keyboard and letter-key changes land on rows a height-capped dialog may have scrolled out of view.
  const selectedAccount = chips.find(chip => chip.selected)?.profile.id;
  const shownAccount = useRef(selectedAccount);
  useEffect(() => {
    dialog.current?.querySelector('.sw-row[data-highlight], .sw-row[data-selected]')?.scrollIntoView?.({ block: 'nearest' });
  }, [view, highlight, currentRow?.id]);
  useEffect(() => {
    if (shownAccount.current !== undefined && shownAccount.current !== selectedAccount) {
      dialog.current?.querySelector('.sw-account[aria-pressed=true]')?.scrollIntoView?.({ block: 'nearest' });
    }
    shownAccount.current = selectedAccount;
  }, [selectedAccount]);
  useEffect(() => { if (error) dialog.current?.querySelector('.sw-error')?.scrollIntoView?.({ block: 'nearest' }); }, [error]);
  // A control that re-renders away takes focus with it; the open modal keeps it so its keys still work.
  useEffect(() => {
    const element = dialog.current;
    if (element?.open && !element.contains(document.activeElement)) element.focus({ preventScroll: true });
  });

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
      if (view === 'search') closeSearch(); else onClose();
      return;
    }
    if (view === 'search') {
      // The highlight, not a focused result, is what Enter uses, so moving it or typing returns focus to the input.
      if (isButton(event.target) && (key === 'ArrowDown' || key === 'ArrowUp' || (key.length === 1 && key !== ' '))) search.current?.focus();
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        setHighlight(index => results.length ? (index + (key === 'ArrowDown' ? 1 : results.length - 1)) % results.length : 0);
      } else if (key === 'Enter' && !isButton(event.target)) {
        event.preventDefault();
        const result = results[highlight];
        if (result) void run(async () => { await controller.apply(result.setup); await loadModels(); closeSearch(); });
      }
      return;
    }
    if (isTyping(event.target)) return;
    // Arrow, digit and letter keys act on the selection, so Enter afterwards closes rather than pressing a stale focused button.
    if ((key.startsWith('Arrow') || (key.length === 1 && key !== ' ')) && isButton(event.target)) dialog.current?.focus({ preventScroll: true });
    if (key === 'Enter') { if (!isButton(event.target)) { event.preventDefault(); onClose(); } }
    else if (key === '/') { event.preventDefault(); openSearch(); }
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
      if (row) { event.preventDefault(); pick(row); }
    } else if (/^[a-z]$/i.test(key) && chips.length) {
      const chip = chips.find(candidate => candidate.profile.key === key.toUpperCase());
      if (chip) { event.preventDefault(); if (!chip.selected) void chooseAccount(chip.profile); }
    }
  }

  function quickRow(row: Row) {
    const saved = favourites.find(f => f.id === row.id);
    return <li key={row.id} className="sw-row" data-selected={row.selected || undefined} data-unavailable={row.reason ? true : undefined}>
      {/* The current row is already applied, so pressing it closes instead of re-applying its saved effort. */}
      <button type="button" className="sw-select" aria-current={row.selected || undefined} aria-disabled={Boolean(row.reason) || undefined}
        aria-label={`${row.slot ? `${row.slot}. ` : ''}${row.name}`} aria-describedby={row.levels.length ? `${ids}-effort-${row.id}` : undefined} title={row.reason ?? row.provider}
        onClick={() => { if (row.selected && !row.reason) onClose(); else pick(row); }}>
        <kbd className="sw-slot" aria-hidden="true">{row.slot ?? ''}</kbd>
        <Glyph providerId={row.providerId} />
        <span className="sw-name">{row.name}</span>
      </button>
      <Dots id={`${ids}-effort-${row.id}`} levels={row.levels} effort={row.effort} />
      <span className="sw-check" aria-hidden="true">{row.selected ? '✓' : ''}</span>
      {saved ? <button type="button" className="sw-star" aria-pressed="true" aria-label={`Unfavourite ${row.name}`} title="Remove from favourites"
        onClick={() => { void star(row.setup, saved); }}>★</button>
        : row.slot === null && <button type="button" className="sw-keep" aria-label={`Keep ${row.name} as a favourite`} aria-keyshortcuts="Meta+S"
          title="Keep as a favourite (⌘S)" onClick={() => { void star(row.setup, undefined); }}>☆ Keep</button>}
    </li>;
  }
  function searchRow(result: Result, index: number) {
    const saved = favourites.find(f => f.slot === result.slot);
    return <li key={result.id} className="sw-row" data-highlight={index === highlight || undefined}>
      <button type="button" id={`${ids}-${index}`} className="sw-select" aria-label={result.name} onMouseEnter={() => setHighlight(index)}
        onClick={() => { void run(async () => { await controller.apply(result.setup); await loadModels(); closeSearch(); }); }}>
        <span className="sw-slot" aria-hidden="true" /><Glyph providerId={result.setup.providerId} />
        <span className="sw-name">{result.name}</span>
      </button>
      {result.slot !== null && <kbd className="sw-slot" aria-hidden="true">{result.slot}</kbd>}
      <button type="button" className="sw-star" aria-pressed={Boolean(saved)} aria-label={`${saved ? 'Unfavourite' : 'Favourite'} ${result.name}`}
        onClick={() => { void star(result.setup, saved); }}>{saved ? '★' : '☆'}</button>
    </li>;
  }

  const daybreakToggle = Boolean(daybreakOption && !daybreakOption.fixed && composer.scope.kind === 'thread');
  const connectorProfile = providerId === 'claude-code' ? shownProfile : undefined;
  const now = !loading && currentModel && (efforts.length > 0 || tiers.length > 0 || daybreakToggle || connectorProfile);
  const offset = (group: number) => groups.slice(0, group).reduce((total, g) => total + g.results.length, 0);
  const position = sheet ? null : placement(anchor, { width: window.innerWidth, height: window.innerHeight });
  return <dialog ref={dialog} tabIndex={-1} className="sw-dialog" data-anchored={position ? true : undefined} data-sheet={sheet || undefined} style={position ?? undefined}
    aria-label="Switch model" aria-busy={busy || loading} data-working={busy || undefined} onKeyDown={keyboard}
    onCancel={event => { event.preventDefault(); }}
    onClick={event => {
      const element = event.currentTarget;
      // Close on click, not pointerdown: the rest of a tap on the backdrop would land on the chip and reopen the switcher.
      if (event.target === element) {
        const box = element.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
        return;
      }
      // A mouse click leaves no focus on the button, so Enter afterwards closes as documented.
      if ((event.nativeEvent as PointerEvent).pointerType === 'mouse' && isButton(event.target)) (view === 'search' ? search.current : element)?.focus({ preventScroll: true });
    }}>
    {view === 'quick' ? <>
      {now && <div className="sw-now" role="group" aria-label="Current model settings">
        {efforts.length > 0 && <div className="sw-seg" role="group" aria-label="Effort">
          {efforts.map(level => <button type="button" key={level} aria-pressed={current.reasoningLevel === level} onClick={() => setEffort(level)}>{level}</button>)}
        </div>}
        {singleTier && <button type="button" className="sw-pill" aria-pressed={activeTier === singleTier.id}
          onClick={() => setServiceTier(activeTier === singleTier.id ? 'default' : singleTier.id)}>{tierLabel(singleTier.id, currentModel)}</button>}
        {tiers.length > 1 && <div className="sw-seg" role="group" aria-label="Speed">
          {['default', ...tiers.map(tier => tier.id)].map(tier => <button type="button" key={tier}
            aria-pressed={activeTier === tier} onClick={() => setServiceTier(tier)}>{tierLabel(tier, currentModel)}</button>)}
        </div>}
        {daybreakToggle && <button type="button" className="sw-pill" aria-pressed={Boolean(daybreak)} onClick={toggleDaybreak}>Daybreak</button>}
        {connectorProfile && <button type="button" role="switch" className="sw-pill sw-connectors" aria-checked={connectors[connectorProfile.id] === true}
          aria-label={`${connectorProfile.label} connectors`} title={`Apps connected through ${connectorProfile.label}, such as Slack`}
          onClick={() => toggleConnectors(connectorProfile)}><PlugIcon />Connectors {connectors[connectorProfile.id] ? 'on' : 'off'}</button>}
      </div>}
      {loading ? <p role="status" className="sw-empty">Loading…</p> : <ul className="sw-list" aria-label="Favourites">{rows.map(quickRow)}
        {favourites.length < 9 && <li className="sw-row sw-add"><button type="button" className="sw-select" onClick={openSearch}>
          <span className="sw-slot" aria-hidden="true" /><span className="sw-glyph" aria-hidden="true">+</span><span className="sw-name">Add model…</span></button></li>}
      </ul>}
      {chips.length > 0 && <div className="sw-accounts" role="group" aria-label={providerId === 'claude-code' ? 'Claude account' : 'Antigravity account'}>
        {chips.map(chip => <button type="button" key={chip.profile.id} className="sw-account" aria-pressed={chip.selected}
          data-target={work?.accountId === chip.profile.id || undefined} aria-keyshortcuts={chip.profile.key ?? undefined}
          aria-label={`${chip.profile.label}${chip.pending ? ', next turn' : ''}${chip.connectors ? ', connectors on' : ''}`}
          aria-describedby={`${ids}-quota-${chip.profile.id}`}
          onClick={() => { if (!chip.selected) void chooseAccount(chip.profile); }}>
          <AccountBadge chip={chip} usage={quotas[chip.profile.id]} />
          <span id={`${ids}-quota-${chip.profile.id}`} hidden>{quotas[chip.profile.id] ? ring(quotas[chip.profile.id]).label : 'Checking usage…'}</span>
          {chip.connectors && <span className="sw-plug" title="Connectors on" aria-hidden="true"><PlugIcon /></span>}
          <span className="sw-account-name">{chip.profile.label}</span>
          {chip.pending && <span className="sw-next">next turn</span>}
        </button>)}
      </div>}
      {providerId === 'claude-code' && accounts && !accounts.supported && <p className="sw-empty" role="status">
        Account choice opens after the first message. New Claude threads start on your remembered account.</p>}
      <button type="button" className="sw-search-row" aria-label="All models" aria-keyshortcuts="/" onClick={openSearch}>
        <span aria-hidden="true">⌕</span><span>All models</span><kbd>/</kbd></button>
    </> : <>
      <div className="sw-search">
        <button type="button" className="sw-back" aria-label="Back to favourites" title="Back (esc)" onClick={closeSearch}>‹</button>
        <input ref={search} role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={`${ids}-results`}
          aria-activedescendant={results[highlight] ? `${ids}-${highlight}` : undefined}
          aria-label="Search models" placeholder="Search models" value={query} autoComplete="off" spellCheck={false}
          onChange={event => { setQuery(event.target.value); setHighlight(0); }} /></div>
      <div className="sw-results" id={`${ids}-results`}>
        {groups.map((group, groupIndex) => <section key={group.providerId} aria-label={group.provider}>
          <h3 className="sw-group">{group.provider}</h3>
          {group.error ? <p className="sw-empty" title={group.error}>Not available on this machine</p>
            : <ul className="sw-list">{group.results.map((result, index) => searchRow(result, offset(groupIndex) + index))}</ul>}
        </section>)}
        {!groups.length && <p className="sw-empty">No models match.</p>}
      </div>
      <div className="sw-foot" aria-hidden="true">{results.length > 0 && <><span><kbd>↵</kbd> use</span><span><kbd>⌘S</kbd> favourite</span></>}<span><kbd>esc</kbd> back</span></div>
    </>}
    {work && <p role="status" className="sw-working">{work.status}</p>}
    {error && <p role="alert" className="sw-error">{error}</p>}
  </dialog>;
}
