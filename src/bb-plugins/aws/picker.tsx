import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import type { PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { rpcContract, StateView, ThreadView } from './contracts.ts';

type Rpc = PluginRpcClient<typeof rpcContract>;
type Row = { profile: string | null; label: string; aside: string; warn: boolean };

const REGION = /^[a-z]{2}(-[a-z0-9]+)+-\d+$/;

function ago(at: number, now: number): string {
  const mins = Math.round((now - at) / 60_000);
  return mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
}

export function rowsFor(state: StateView, filter: string): Row[] {
  const query = filter.trim().toLowerCase();
  const profiles = state.profiles
    .filter(p => p.name.toLowerCase().includes(query))
    .map((p): Row => ({
      profile: p.name, label: p.name,
      aside: p.status === 'signing-in' ? 'signing in…' : p.status === 'sign-in' ? 'sign in' : p.region ?? '',
      warn: p.status !== 'ok',
    }));
  const off: Row = { profile: null, label: 'Off', aside: 'no AWS credentials', warn: false };
  return query && !'off'.includes(query) ? profiles : [off, ...profiles];
}

const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function AwsPicker({ rpc, threadId, state, thread, loadError, refresh, onClose }: {
  rpc: Rpc; threadId: string; state: StateView | null; thread: ThreadView | null; loadError: string | null;
  refresh: () => Promise<void>; onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  const [region, setRegion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [regionError, setRegionError] = useState<string | null>(null);
  /** The row whose choice is being saved: one save at a time, so a second click cannot overtake the first. */
  const [saving, setSaving] = useState<Row | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [retrying, setRetrying] = useState(false);
  /** Retries that ended, so a retry that fails again shows, and announces, a new message. */
  const [retries, setRetries] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  /** False once this picker closes, so a save that ends later cannot close a picker opened since. */
  const alive = useRef(true);
  const ids = useId();
  const rowId = (i: number) => `${ids}-row-${i}`;
  const list = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  /** Set by a keyboard move, so the active row scrolls into view; a mouse hover does not scroll. */
  const follow = useRef(false);
  /** Where the pointer last was. A list that scrolls under a still pointer sends mouse events too; only a real move hovers. */
  const pointer = useRef<string | null>(null);
  /** Set once the person edits the region, so a load that lands later cannot overwrite what they typed. */
  const regionEdited = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const rows = useMemo(() => state ? rowsFor(state, filter) : [], [state, filter]);
  const current = thread?.choice.profile ?? null;
  const reveal = (i: number) => list.current?.querySelectorAll('.aws-row')[i]?.scrollIntoView?.({ block: 'nearest' });

  useEffect(() => { if (!regionEdited.current) setRegion(thread?.choice.region ?? ''); }, [thread?.choice.region]);
  // The message can render below the fold of a short window, under the button that caused it.
  useEffect(() => { if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [error]);
  useEffect(() => { setIndex(i => Math.min(i, Math.max(rows.length - 1, 0))); }, [rows.length]);
  useEffect(() => {
    alive.current = true;
    input.current?.focus();
    return () => { alive.current = false; };
  }, []);
  // A control that leaves while focused, such as Retry after a load or Sign in after a sign-in, drops focus
  // to the page. Return it to the filter, so arrows and Enter keep working and keys stay in the dialog.
  useEffect(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body) input.current?.focus({ preventScroll: true });
  });
  // Start on the thread's current choice, so Enter on open keeps it rather than picking Off.
  // A layout effect, so no keystroke lands between the rows appearing and the move.
  useLayoutEffect(() => {
    if (placed.current || !state || !thread) return;
    placed.current = true;
    const at = rows.findIndex(row => row.profile === current);
    if (at > 0) { setIndex(at); reveal(at); }
  });
  useEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    reveal(index);
  });

  async function pick(row: Row) {
    if (saving) return;
    setError(null);
    // Off has no region, so a bad override cannot block it.
    const override = row.profile ? region.trim() : '';
    if (override && !REGION.test(override)) { setRegionError(`${override} is not an AWS region name.`); return; }
    setRegionError(null);
    setSaving(row);
    try {
      await rpc.call('setChoice', { threadId, choice: { profile: row.profile, region: override || null } });
      if (!alive.current) return;
      if (row.warn) await refresh();
      else onClose();
    } catch (cause) {
      setError(`Could not save the choice: ${message(cause)}`);
    } finally {
      setSaving(null);
    }
  }

  async function signIn(profile: string) {
    if (signingIn || state?.profiles.find(p => p.name === profile)?.status === 'signing-in') return;
    setError(null);
    setSigningIn(true);
    try {
      const result = await rpc.call('signIn', { profile });
      if (!result.ok) setError(result.message);
    } catch (cause) {
      setError(`Could not start the sign-in: ${message(cause)}`);
    } finally {
      setSigningIn(false);
    }
    // A sign-in can end after the picker closes; a load then would fill the next picker with this one's thread.
    if (alive.current) await refresh();
  }

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    if (alive.current) await refresh();
    setRetrying(false);
    setRetries(n => n + 1);
  }

  function move(step: number) {
    follow.current = true;
    setIndex(i => (i + step + rows.length) % Math.max(rows.length, 1));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    const target = event.target as HTMLElement;
    // A click on plain text focuses the dialog itself; typing and Enter still belong to the filter.
    if (target === event.currentTarget) input.current?.focus({ preventScroll: true });
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    // Enter on a focused button presses it; an IME's Enter only ends the composition.
    else if (event.key === 'Enter' && target.tagName !== 'BUTTON' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const row = rows[index];
      if (row) void pick(row);
    }
  }

  const selected = current ? state?.profiles.find(p => p.name === current) : undefined;
  const waiting = signingIn || selected?.status === 'signing-in';
  const listId = `${ids}-rows`;
  const regionErrorId = `${ids}-region-error`;
  // aria-disabled, not disabled: a disabled button drops focus out of the dialog.
  // A mouse press keeps focus in the filter, as for rows, so Enter afterwards picks the highlighted row.
  const keepFocus = (event: MouseEvent) => event.preventDefault();
  const hover = (event: MouseEvent, i: number) => {
    const at = `${event.clientX},${event.clientY}`;
    const moved = pointer.current !== null && pointer.current !== at;
    pointer.current = at;
    if (moved) setIndex(i);
  };
  const retryButton = <button type="button" aria-disabled={retrying || undefined} onMouseDown={keepFocus} onClick={() => void retry()}>
    {retrying ? 'Retrying…' : 'Retry'}
  </button>;
  // Keyed by retries, so a retry that fails again redraws the alert and is announced again.
  const problem = (text: string) => <div className="aws-problem">
    <p key={retries} className="aws-error" role="alert">{text}</p>{retryButton}
  </div>;
  return <ChipPopover aria-label="AWS profile" trigger={() => null} anchor={null} width={420} instant
    panelClassName="aws-panel" onKeyDown={onKeyDown} onClose={onClose}>
    <header className="aws-header">
      <h2>AWS profile</h2>
      {thread && <span className="aws-muted">
        {current ? `${current}${thread.region ? ` · ${thread.region}` : ''}` : 'off'}
        {/* A fetch for an earlier profile says nothing about the current one. */}
        {thread.lastFetch && current && thread.lastFetch.profile === current && ` · used ${ago(thread.lastFetch.at, Date.now())}`}
      </span>}
    </header>
    <div className="aws-fields">
      <input ref={input} className="aws-input" aria-label="Filter profiles"
        // The count tells a long list from a short one when the cut falls between rows.
        placeholder={state?.profiles.length ? `Filter ${state.profiles.length} profile${state.profiles.length === 1 ? '' : 's'}` : 'Filter profiles'}
        role="combobox" aria-autocomplete="list" aria-expanded={rows.length > 0} aria-controls={listId}
        aria-activedescendant={rows[index] ? rowId(index) : undefined}
        value={filter} onChange={event => {
          const value = event.target.value;
          setFilter(value);
          // An empty filter goes back to the current choice, so Enter keeps it rather than picking Off.
          setIndex(!value.trim() && state ? Math.max(rowsFor(state, '').findIndex(row => row.profile === current), 0) : 0);
        }} />
      <input className="aws-input aws-region" placeholder="region (profile's)" aria-label="Region override"
        aria-invalid={regionError ? true : undefined} aria-describedby={regionError ? regionErrorId : undefined}
        value={region} onChange={event => { regionEdited.current = true; setRegion(event.target.value); setRegionError(null); }} />
    </div>
    {regionError && <p id={regionErrorId} className="aws-error aws-region-error" role="alert">{regionError}</p>}
    {!state ? loadError ? problem(`${retries ? 'Still could not' : 'Could not'} load AWS profiles: ${loadError}`)
        : <p className="aws-empty" role="status">Loading…</p>
      : <>
        {/* A failed refresh says more about the list than the error it loaded with, so only one alert shows.
            It takes the same place, so a focused Retry stays mounted and keeps focus. */}
        {state.error && problem(loadError ? `Could not refresh AWS profiles: ${loadError}` : state.error)}
        {/* Rows never take focus: it stays in the filter, which points at the active row, so Enter
            always picks the highlighted row and a disabled row cannot drop focus. */}
        <div ref={list} id={listId} className="aws-rows" role="listbox" aria-label="Profiles" aria-busy={saving ? true : undefined}>
          {rows.map((row, i) => <button key={row.profile ?? 'off'} id={rowId(i)} type="button" role="option" tabIndex={-1}
            className="aws-row" data-active={i === index ? '' : undefined} aria-selected={i === index}
            aria-current={row.profile === current || undefined} disabled={!!saving}
            onMouseDown={event => event.preventDefault()} onMouseMove={event => hover(event, i)}
            // A tap or quick click can arrive without a hover, so the clicked row becomes the highlighted one.
            onClick={() => { setIndex(i); void pick(row); }}>
            <span className="aws-row-label" title={row.label}>{row.label}</span>
            <span className="aws-row-aside" data-warn={row.warn && saving?.profile !== row.profile ? '' : undefined}>
              {saving?.profile === row.profile ? 'saving…' : row.aside}{row.profile === current && ' ✓'}
            </span>
          </button>)}
        </div>
        {rows.length === 0 && state.profiles.length > 0 && <p className="aws-empty">No profile matches.</p>}
        {!state.error && state.profiles.length === 0 && <p className="aws-empty">No profiles in the AWS config file.</p>}
      </>}
    {/* Always present, so a screen reader hears the box appear after choosing a profile that needs a sign-in. */}
    <div role="status">
      {selected && selected.status !== 'ok' && <p className="aws-signin">
        {waiting ? 'Finish the sign-in in your browser.' : 'This profile needs a sign-in.'}{' '}
        <button type="button" aria-disabled={waiting || undefined} onMouseDown={keepFocus} onClick={() => void signIn(selected.name)}>
          {waiting ? 'Waiting for browser…' : 'Sign in with Granted'}
        </button>
      </p>}
    </div>
    {error && <p ref={errorRef} className="aws-error" role="alert">{error}</p>}
    {state && !state.error && loadError && !error && problem(`Could not refresh AWS profiles: ${loadError}`)}
    <footer className="aws-footer">
      <span className="aws-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> choose <kbd>esc</kbd> close</span>
      <span>Applies to this thread's next AWS call. Agents cannot sign in.</span>
    </footer>
  </ChipPopover>;
}
