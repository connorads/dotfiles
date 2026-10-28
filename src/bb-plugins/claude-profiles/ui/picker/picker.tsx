import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useComposer, useComposers, useRpc, useSdk, useRealtime,
  experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import type { PluginComposerApi } from '@get-bb/plugin-sdk/app';
import { toast } from 'sonner';
import type { Profile, rpcContract } from '../../contracts.ts';
import { effortSchema, type Effort, type Favourite } from '../../src/models/contract.ts';
import { availability, capture, matches } from '../../src/models/favourites.ts';
import { accountUnavailable, isClaude } from '../account-status.tsx';
import { AccountPicker } from './account-picker.tsx';
import { AccountMenu } from './account-menu.tsx';
import { AccountConnectors } from './connectors.tsx';
import { effortLabel, EffortPill, Segmented } from './controls.tsx';
import { createController, type Controller } from './controller.ts';
import { closeInnermostPopover } from './popover.tsx';
import { close, open, openedState, subscribe } from './store.ts';
import './picker.css';

const controllers = new Map<string, Controller>();
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not update the model picker.';

export function useController(composer: PluginComposerApi) {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  return useMemo(() => createController(composer, sdk, rpc), [composer, sdk, rpc]);
}
export function CommandOwner() {
  const composer = useComposer();
  const controller = useController(composer);
  useEffect(() => {
    controllers.set(composer.key, controller);
    return () => { if (controllers.get(composer.key) === controller) controllers.delete(composer.key); };
  }, [composer, controller]);
  return null;
}
export function Overlay() {
  const opened = useSyncExternalStore(subscribe, openedState);
  const composers = useComposers();
  const composer = composers.find(candidate => candidate.key === opened?.key);
  useEffect(() => { if (opened && !composer) close(); }, [opened, composer]);
  if (!composer) return null;
  const onClose = () => { close(); composer.focus(); };
  return opened?.focus === 'account' ? <AccountPicker key={composer.key} composer={composer} onClose={onClose} />
    : <ModelPicker key={composer.key} composer={composer} onClose={onClose} />;
}

export function ModelPicker({ composer, onClose }: { composer: PluginComposerApi; onClose: () => void }) {
  const ownController = useController(composer);
  const controller = controllers.get(composer.key) ?? ownController;
  const rpc = useRpc<typeof rpcContract>();
  const [daybreak, setDaybreak] = useState<boolean | undefined>();
  const [list, setList] = useState<Favourite[]>([]);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<Controller['catalog']>>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [accounts, setAccounts] = useState<{ supported: boolean; profiles: Profile[]; currentId: string } | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const chipStrip = useRef<HTMLDivElement>(null);
  const [chipOverflow, setChipOverflow] = useState({ start: false, end: false });
  const threadId = composer.scope.kind === 'thread' ? composer.scope.threadId : null;
  // Queued-message editors cannot change a thread's account; choosing there would rewrite the next-thread account.
  const claude = isClaude(composer);
  const currentProvider = composer.selection?.providerId;
  const environmentKey = JSON.stringify(composer.selection?.environment);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const [saved, available, programme] = await Promise.all([rpc.call('favourites.list', {}), controller.catalog(), controller.daybreak()]);
      if (current !== generation.current) return;
      setList(saved); setCatalog(available); setDaybreak(programme);
    } catch (cause) { if (current === generation.current) setError(message(cause)); }
    finally { if (current === generation.current) setLoading(false); }
  }, [rpc, controller]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh, currentProvider, environmentKey, composer.selection?.model, composer.isRunning]);
  useRealtime('favourites-changed', () => { void refresh(); });
  const accountGeneration = useRef(0);
  const loadAccounts = useCallback(async () => {
    const current = ++accountGeneration.current;
    if (!claude) { setAccounts(null); return; }
    setProfilesLoading(true); setProfileError(null);
    try { const value = await rpc.call('accounts', { threadId }); if (current === accountGeneration.current) setAccounts(value); }
    catch (cause) { if (current === accountGeneration.current) setProfileError(message(cause)); }
    finally { if (current === accountGeneration.current) setProfilesLoading(false); }
  }, [claude, threadId, rpc]);
  // A thread gains its environment during the first turn, so reload when a turn ends.
  useEffect(() => { void loadAccounts(); return () => { accountGeneration.current++; }; }, [loadAccounts, composer.isRunning]);
  useRealtime('profiles-changed', () => { void loadAccounts(); });
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal(); searchInput.current?.focus();
    return () => { element.close(); };
  }, []);
  // Rows load after the dialog opens, so the first loaded list scrolls once to the selected row without taking focus.
  const revealed = useRef(false);
  useLayoutEffect(() => {
    if (loading || revealed.current) return;
    revealed.current = true;
    dialog.current?.querySelector('.mf-list [data-selected]')?.scrollIntoView?.({ block: 'center' });
  }, [loading]);
  async function run(work: () => Promise<unknown>, reload = false) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null);
    try { await work(); if (reload) await refresh(); }
    catch (cause) { setError(message(cause)); }
    finally { working.current = false; setBusy(false); }
  }
  function choose(favourite: Favourite) { void run(async () => { await controller.apply(favourite); onClose(); }); }
  function toggleFavourite(row: Row) {
    void run(async () => {
      if (row.saved) await rpc.call('favourites.remove', { id: row.favourite.id });
      else await rpc.call('favourites.add', { name: '', ...capture(row.favourite, row.favourite.daybreak) });
    }, true);
  }
  function setEffort(favourite: Favourite, effort: Effort | null) {
    void run(() => rpc.call('favourites.setEffort', { id: favourite.id, reasoningLevel: effort }), true);
  }
  const providerName = (id: string) => catalog.find(p => p.providerId === id)?.providerName ?? id;
  const modelOf = (id: string, model: string) => catalog.find(p => p.providerId === id)?.models.find(m => m.model === model);
  const displayName = (f: Favourite) => `${modelOf(f.providerId, f.model)?.displayName ?? f.model}${f.daybreak ? ' · Daybreak' : ''}`;
  const search = query.trim().toLowerCase();
  const visible = (providerId: string, text: string) => (filter === 'all' || filter === 'favourites' || filter === providerId) && text.toLowerCase().includes(search);
  const favouriteRows: Row[] = list.filter(f => visible(f.providerId, `${displayName(f)} ${providerName(f.providerId)} ${f.model}`))
    .map(f => {
      const providerCatalog = catalog.find(p => p.providerId === f.providerId);
      return { favourite: f, saved: true, reason: providerCatalog
        ? controller.scopeReason(f) ?? availability(f, { available: true, error: providerCatalog.error, models: providerCatalog.models }) : 'Provider unavailable on this machine' };
    });
  const providers = catalog.filter(p => p.models.length > 0 || p.error);
  // A failed catalogue only matches searches for its provider's name, so it never clutters model searches.
  const groups = filter === 'favourites' ? [] : providers.filter(p => (filter === 'all' || filter === p.providerId)
    && (!p.error || p.providerName.toLowerCase().includes(search))).map(p => ({ ...p,
    rows: p.models.flatMap(m => {
      const option = m.sessionOptions?.filter(option => option.type === 'boolean').find(option => option.id === 'daybreak');
      const programmes = option ? (option.fixed ? [option.value === true] : [false, true]) : [false];
      return programmes.map(programme => ({ id: `${p.providerId}:${m.model}:${programme}`, slot: 1, name: '', providerId: p.providerId, model: m.model,
        ...(option && (programme || (composer.scope.kind === 'thread' && currentProvider === p.providerId)) ? { daybreak: programme } : {}) }));
    }).filter(f => !list.some(saved => saved.providerId === f.providerId && saved.model === f.model && (saved.daybreak ?? false) === (f.daybreak ?? false))
      && visible(p.providerId, `${displayName(f)} ${f.model} ${p.providerName}`))
      .map((favourite): Row => ({ favourite, saved: false, reason: controller.scopeReason(favourite) })),
  }));
  const rows = [...favouriteRows, ...groups.flatMap(group => group.rows)];
  const currentModel = modelOf(currentProvider ?? '', composer.selection?.model ?? '');
  const hasResults = favouriteRows.length > 0 || groups.some(p => p.rows.length > 0 || p.error);
  const blocked = busy || loading;
  // Enter in search clicks the first enabled row; mark it so the choice is visible before pressing.
  const enterTarget = search && !blocked ? rows.find(candidate => !candidate.reason)?.favourite.id : undefined;
  const rowOf = (target: EventTarget) => {
    const id = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-row]')?.dataset.row : undefined;
    return rows.find(row => row.favourite.id === id);
  };
  function step(row: Row, direction: -1 | 1) {
    const levels = modelOf(row.favourite.providerId, row.favourite.model)?.supportedReasoningEfforts.map(e => e.reasoningEffort) ?? [];
    const sequence: (Effort | null)[] = [null, ...levels];
    const index = sequence.indexOf(row.favourite.reasoningLevel ?? null);
    const next = sequence[index === -1 ? 0 : Math.min(sequence.length - 1, Math.max(0, index + direction))];
    if (next !== undefined && (index === -1 || next !== sequence[index])) setEffort(row.favourite, next);
  }
  function keyboard(event: React.KeyboardEvent<HTMLDialogElement>) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    const target = event.target;
    const inSearch = target === searchInput.current;
    const onRow = target instanceof HTMLElement && target.hasAttribute('data-model');
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      const row = rowOf(target);
      if (row && !blocked && (row.saved || (list.length < 9 && !row.reason))) toggleFavourite(row);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.key === 'q' || event.key === 'Q') && !(event.defaultPrevented || (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')))) {
      event.preventDefault(); if (!working.current) onClose();
    } else if (event.key === 'Enter' && inSearch) {
      event.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>('[data-model]:not([aria-disabled=true])')?.click();
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && (inSearch || onRow)) {
      event.preventDefault();
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('[data-model]') ?? []);
      const current = buttons.findIndex(button => button === target);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (current === 0 && direction === -1) { searchInput.current?.focus(); return; }
      const next = buttons[current < 0 ? (direction === 1 ? 0 : buttons.length - 1) : Math.min(buttons.length - 1, current + direction)];
      next?.focus(); next?.scrollIntoView?.({ block: 'nearest' });
    } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && onRow) {
      const row = rowOf(target);
      if (row?.saved) { event.preventDefault(); if (!blocked) step(row, event.key === 'ArrowRight' ? 1 : -1); }
    } else if ((onRow || (inSearch && query === '') || target === event.currentTarget) && /^[1-9]$/.test(event.key)) {
      const favourite = list.find(f => f.slot === Number(event.key));
      if (favourite && !blocked) { event.preventDefault(); choose(favourite); }
    }
  }
  function row({ favourite, saved, reason }: Row) {
    const selected = matches(favourite, composer.selection, daybreak);
    const model = modelOf(favourite.providerId, favourite.model);
    const name = displayName(favourite);
    const levels = model?.supportedReasoningEfforts.map(e => e.reasoningEffort) ?? [];
    const unavailable = Boolean(reason);
    const unknownProgramme = composer.scope.kind !== 'thread' && model?.sessionOptions?.some(option => option.id === 'daybreak');
    const starBlocked = !saved && (list.length >= 9 || unavailable || Boolean(unknownProgramme));
    return <li className="mf-row" key={favourite.id} data-row={favourite.id} data-selected={selected || undefined} data-unavailable={unavailable || undefined}
      data-enter-target={favourite.id === enterTarget || undefined}>
      <button type="button" data-model className="mf-select" aria-disabled={blocked || unavailable || undefined}
        aria-label={`Select ${name}`} aria-current={selected || undefined} aria-keyshortcuts={saved ? `${favourite.slot}` : undefined}
        onClick={() => { if (!blocked && !unavailable) choose(favourite); }}>
        {saved ? <kbd className="mf-slot" aria-hidden="true">{favourite.slot}</kbd> : <span className="mf-slot" aria-hidden="true" />}
        <span className="mf-model-name">{name}</span>
        {(reason || saved || search) && <span className="mf-detail">{reason ?? providerName(favourite.providerId)}</span>}
      </button>
      {saved && model && (levels.length > 0 || favourite.reasoningLevel) && <EffortPill name={name} saved={favourite.reasoningLevel} fallback={model.defaultReasoningEffort}
        levels={levels} disabled={blocked} onChange={effort => setEffort(favourite, effort)} />}
      <span className="mf-check" aria-hidden="true">{selected && <Icon name="Check" className="mf-check-icon" />}</span>
      <button type="button" className="mf-star" data-saved={saved || undefined} aria-label={`${saved ? 'Unfavourite' : 'Favourite'} ${name}`} aria-pressed={saved}
        title={saved ? 'Remove favourite' : unknownProgramme ? 'Save this favourite after starting a thread so its Daybreak setting can be read.' : list.length >= 9 ? 'Nine favourites saved. Remove one to make space.' : 'Favourite model'}
        aria-disabled={blocked || starBlocked || undefined} onClick={() => { if (!blocked && !starBlocked) toggleFavourite({ favourite, saved, reason }); }}>
        <Icon name="Star" className="mf-star-icon" />
      </button>
    </li>;
  }
  async function changeOption(field: 'reasoningLevel' | 'serviceTier', value: string) {
    const selection = { providerId: composer.selection?.providerId, model: composer.selection?.model, [field]: value };
    const settled = await composer.setSelection(selection);
    if (settled[field] !== value) throw new Error('This option is unavailable for the current model.');
  }
  // Fades mark the edges with hidden chips, so a clipped strip reads as scrollable.
  const measureChips = useCallback(() => {
    const strip = chipStrip.current;
    if (!strip) return;
    const start = strip.scrollLeft > 1;
    const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
    setChipOverflow(previous => previous.start === start && previous.end === end ? previous : { start, end });
  }, []);
  useLayoutEffect(measureChips, [measureChips, providers.length]);
  useEffect(() => {
    const strip = chipStrip.current;
    if (!strip || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureChips);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [measureChips]);
  const daybreakOption = currentModel?.sessionOptions?.filter(option => option.type === 'boolean').find(option => option.id === 'daybreak');
  const tiers = currentModel?.supportedServiceTiers ?? [];
  const chips = [{ id: 'all', label: 'All' }, { id: 'favourites', label: 'Favourites', count: list.length },
    ...providers.map(p => ({ id: p.providerId, label: p.providerName }))];
  return <dialog ref={dialog} className="mf-dialog" aria-label="Switch model" onKeyDown={keyboard}
    onCancel={event => { event.preventDefault(); if (!closeInnermostPopover() && !working.current) onClose(); }}
    onPointerDown={event => { if (event.target === event.currentTarget && !working.current) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    } }}>
    <div className="mf-picker">
      <div className="mf-head">
        <div className="mf-search"><Icon name="Search" className="mf-search-icon" />
          <input ref={searchInput} aria-label="Search models" placeholder="Search models or providers…" value={query}
            autoComplete="off" spellCheck={false} onChange={event => setQuery(event.target.value)} />
          <button type="button" className="mf-dismiss" aria-label="Close model switcher" disabled={busy} onClick={onClose}><kbd className="mf-kbd">esc</kbd></button>
        </div>
        <div ref={chipStrip} className="mf-chips" role="group" aria-label="Filter models" onScroll={measureChips}
          data-more-start={chipOverflow.start || undefined} data-more-end={chipOverflow.end || undefined}>
          {chips.map(chip => <button type="button" key={chip.id} aria-pressed={filter === chip.id} onClick={() => { setFilter(chip.id); searchInput.current?.focus(); }}>
            {chip.id === 'favourites' && <Icon name="Star" className="mf-chip-star" />}{chip.label}
            {'count' in chip && <span className="mf-count">{chip.count}</span>}
          </button>)}
        </div>
      </div>
      {error && <div role="alert" className="mf-error">{error} <button type="button" disabled={busy} onClick={() => { setError(null); void refresh(); }}>Retry</button></div>}
      <div className="mf-list" aria-label="Models" aria-busy={loading || busy}>
        {loading && <p role="status" className="mf-empty">Loading models…</p>}
        {!loading && !hasResults && <div className="mf-empty">{filter === 'favourites' && !query ? 'Star a model to keep it here.' : 'No models found.'}<br /><span>{filter === 'favourites' && !query ? 'Browse All to choose your favourites.' : 'Try another name or provider.'}</span></div>}
        {favouriteRows.length > 0 && <section aria-labelledby="mf-favourites"><h3 id="mf-favourites" className="mf-section">Favourites <span>{list.length}/9</span></h3>
          <ul>{favouriteRows.map(row)}</ul></section>}
        {groups.map(p => (p.rows.length > 0 || p.error) && <section key={p.providerId} aria-label={p.providerName}>
          <h3 className="mf-section">{p.providerName}</h3>
          {p.error ? <p className="mf-unavailable" title={p.error}>Not available on this machine</p> : <ul>{p.rows.map(row)}</ul>}
        </section>)}
      </div>
      <div className="mf-now" role="group" aria-label="Current selection">
        <div className="mf-now-model"><span className="mf-now-label">Now</span>
          <span className="mf-now-name">{currentModel?.displayName ?? composer.selection?.model ?? 'Choose a model'}{daybreak && ' · Daybreak'}</span>
          {currentProvider && <span className="mf-now-provider">{providerName(currentProvider)}</span>}
        </div>
        <div className="mf-now-options">
          {daybreakOption && <div className="mf-field"><span aria-hidden="true">Daybreak</span>
            {composer.scope.kind !== 'thread' ? <span>Set in BB’s native model picker before starting a thread.</span>
              : daybreakOption.fixed ? <span>{daybreakOption.value ? 'Required for this model' : 'Unavailable for this model'}</span>
              : <Segmented label="Daybreak" disabled={blocked || daybreak === undefined} value={String(daybreak ?? daybreakOption.value)}
                options={[{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }]}
                onChange={value => { if (currentModel && currentProvider) void run(async () => {
                  await controller.apply({ providerId: currentProvider, model: currentModel.model, reasoningLevel: effortSchema.optional().parse(composer.selection?.reasoningLevel), daybreak: value === 'true' });
                  setDaybreak(value === 'true');
                }, true); }} />}
          </div>}

          {currentModel && currentModel.supportedReasoningEfforts.length > 0 && <div className="mf-field"><span aria-hidden="true">Effort</span><Segmented label="Reasoning effort" disabled={blocked}
            value={composer.selection?.reasoningLevel ?? currentModel.defaultReasoningEffort}
            options={currentModel.supportedReasoningEfforts.map(e => ({ value: e.reasoningEffort, label: effortLabel(e.reasoningEffort) }))}
            onChange={value => { void run(() => changeOption('reasoningLevel', value)); }} /></div>}
          {tiers.length > 0 && <div className="mf-field"><span aria-hidden="true">Tier</span><Segmented label="Service tier" disabled={blocked} value={composer.selection?.serviceTier ?? 'default'}
            options={[{ value: 'default', label: 'Default' }, ...tiers.filter(t => t.id !== 'default').map(t => ({ value: t.id, label: t.label ?? t.id }))]}
            onChange={value => { void run(() => changeOption('serviceTier', value)); }} /></div>}
        </div>
      </div>
      {claude && <div className="mf-account">
        {accounts?.supported ? <AccountMenu threadId={threadId} profiles={accounts.profiles} currentId={accounts.currentId} buttonRef={accountButton}
          disabled={busy || profilesLoading || composer.isRunning || composer.isSubmitting}
          onChoose={profileId => { void run(async () => {
            const { currentId } = await rpc.call('choose', { threadId, profileId });
            setAccounts(previous => previous ? { ...previous, currentId } : previous);
          }); }} />
          : <span>{profilesLoading ? 'Loading Claude accounts…' : profileError ?? accountUnavailable}</span>}
        {accounts?.supported && composer.isRunning ? <small>Available when this turn finishes.</small>
          : !threadId && accounts?.supported && <small>New Claude threads start on this account.</small>}
        {accounts?.supported && profileError && <small role="alert">{profileError}</small>}
        <button type="button" className="mf-refresh" aria-label="Refresh Claude accounts" title="Refresh Claude accounts" disabled={busy || profilesLoading} onClick={() => { void loadAccounts(); }}><Icon name="ArrowReloadHorizontal" className="mf-refresh-icon" /></button>
      </div>}
      {claude && accounts?.supported && <AccountConnectors threadId={threadId} profiles={accounts.profiles}
        disabled={busy || profilesLoading || composer.isRunning || composer.isSubmitting} />}
      <div className="mf-footer" aria-hidden="true">
        <span><kbd className="mf-kbd">↑</kbd><kbd className="mf-kbd">↓</kbd> move</span>
        <span><kbd className="mf-kbd">↵</kbd> select</span>
        <span><kbd className="mf-kbd">1-9</kbd> favourite</span>
        <span><kbd className="mf-kbd">←</kbd><kbd className="mf-kbd">→</kbd> effort</span>
        <span><kbd className="mf-kbd">⌘S</kbd> star</span>
      </div>
    </div>
  </dialog>;
}
type Row = { favourite: Favourite; saved: boolean; reason: string | null };

export async function command(composer: PluginComposerApi, work: (controller: Controller) => Promise<void>) {
  const controller = controllers.get(composer.key);
  if (!controller) { open(composer); return; }
  try { await work(controller); }
  catch (cause) { toast.error(message(cause)); }
}
