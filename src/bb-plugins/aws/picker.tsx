import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
  const rows = useMemo(() => state ? rowsFor(state, filter) : [], [state, filter]);
  const current = thread?.choice.profile ?? null;
  const reveal = (i: number) => list.current?.querySelectorAll('.aws-row')[i]?.scrollIntoView?.({ block: 'nearest' });

  useEffect(() => { setRegion(thread?.choice.region ?? ''); }, [thread?.choice.region]);
  useEffect(() => { setIndex(i => Math.min(i, Math.max(rows.length - 1, 0))); }, [rows.length]);
  useEffect(() => { input.current?.focus(); return () => { alive.current = false; }; }, []);
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
      setError(message(cause));
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
      setError(message(cause));
    } finally {
      setSigningIn(false);
    }
    await refresh();
  }

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    await refresh();
    setRetrying(false);
    setRetries(n => n + 1);
  }

  function move(step: number) {
    follow.current = true;
    setIndex(i => (i + step + rows.length) % Math.max(rows.length, 1));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
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
  const retryButton = <button type="button" aria-disabled={retrying || undefined} onClick={() => void retry()}>
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
        {thread.lastFetch && ` · used ${ago(thread.lastFetch.at, Date.now())}`}
      </span>}
    </header>
    <div className="aws-fields">
      <input ref={input} className="aws-input" placeholder="Filter profiles" aria-label="Filter profiles"
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
        value={region} onChange={event => { setRegion(event.target.value); setRegionError(null); }} />
    </div>
    {regionError && <p id={regionErrorId} className="aws-error aws-region-error" role="alert">{regionError}</p>}
    {!state ? loadError ? problem(`${retries ? 'Still could not' : 'Could not'} load AWS profiles: ${loadError}`)
        : <p className="aws-empty">Loading…</p>
      : <>
        {state.error && problem(state.error)}
        {/* Rows never take focus: it stays in the filter, which points at the active row, so Enter
            always picks the highlighted row and a disabled row cannot drop focus. */}
        <div ref={list} id={listId} className="aws-rows" role="listbox" aria-label="Profiles" aria-busy={saving ? true : undefined}>
          {rows.map((row, i) => <button key={row.profile ?? 'off'} id={rowId(i)} type="button" role="option" tabIndex={-1}
            className="aws-row" data-active={i === index ? '' : undefined} aria-selected={i === index}
            aria-current={row.profile === current || undefined} disabled={!!saving}
            onMouseDown={event => event.preventDefault()} onMouseEnter={() => setIndex(i)} onClick={() => void pick(row)}>
            <span className="aws-row-label">{row.label}</span>
            <span className="aws-row-aside" data-warn={row.warn && saving?.profile !== row.profile ? '' : undefined}>
              {saving?.profile === row.profile ? 'saving…' : row.aside}{row.profile === current && ' ✓'}
            </span>
          </button>)}
        </div>
        {rows.length === 0 && <p className="aws-empty">No profile matches.</p>}
        {!state.error && state.profiles.length === 0 && <p className="aws-empty">No profiles in the AWS config file.</p>}
      </>}
    {selected && selected.status !== 'ok' && <p className="aws-signin">
      {selected.name} needs a sign-in.{' '}
      <button type="button" aria-disabled={waiting || undefined} onClick={() => void signIn(selected.name)}>
        {waiting ? 'Waiting for browser…' : 'Sign in with Granted'}
      </button>
    </p>}
    {error && <p className="aws-error" role="alert">{error}</p>}
    {state && loadError && !error && problem(`Could not refresh AWS profiles: ${loadError}`)}
    <footer className="aws-footer">
      <span className="aws-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> choose <kbd>esc</kbd> close</span>
      <span>Applies to this thread's next AWS call. Agents cannot sign in.</span>
    </footer>
  </ChipPopover>;
}
