import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import { AddForm, looksLikeMcpUrl } from './add-form.tsx';
import type { ConnectionView, StateView } from './contracts.ts';
import { ExecutorSettings } from './settings.tsx';
import { SignInPanel } from './sign-in.tsx';
import { choose, dismissUnsaved, message, refresh, reportUnsaved, rpc, visibleChip, type Anchor, type Choice } from './store.ts';

type Row = { id: string; keycap: string; choice: Choice; label: ReactNode; aside?: ReactNode; connection?: ConnectionView };

function rowsFor(view: StateView): Row[] {
  const fallback = view.connections.find(c => c.isDefault);
  return [
    { id: 'default', keycap: 'd', choice: { kind: 'default' }, label: 'Default', aside: fallback?.name ?? 'none' },
    // Keys 1-9 reach the first nine; later connections are still rows, picked by arrows or pointer.
    ...view.connections.map((connection, index): Row => ({
      id: `c:${connection.id}`, keycap: index < 9 ? String(index + 1) : '', choice: { kind: 'connection', id: connection.id },
      label: connection.name, connection,
      // A signed-out connection keeps its "sign in" hint even with an error: signing in is the fix.
      aside: connection.status === 'signed-out' ? 'sign in' : connection.status === 'signing-in' ? 'signing in' : view.errors[connection.id] ? 'error' : undefined,
    })),
    { id: 'off', keycap: 'o', choice: { kind: 'off' }, label: 'Off', aside: 'no Executor tools' },
  ];
}

const sameChoice = (a: Choice, b: Choice | undefined) =>
  a.kind === (b?.kind ?? 'default') && (a.kind !== 'connection' || (b?.kind === 'connection' && b.id === a.id));

/**
 * unsaved: why this thread's last pick failed, which may outlive the popover that made it.
 * saving: this thread's pick whose save is in flight, which may have been made by a popover that has closed since.
 */
export function ExecutorPopover({ view, loadError, threadId, choice, saving, unsaved, anchor, instant, onClose }: {
  view: StateView | null; loadError: string | null; threadId: string | null; choice: Choice | undefined; saving: Choice | undefined;
  unsaved: string | null; anchor: Anchor; instant: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // A save outlives a popover closed mid-save; it must not close the next one.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // The row whose save is in flight, or 'add' while an add runs; further picks wait for it so one press sends one request.
  const [pending, setPending] = useState<string | null>(null);
  // The connection being switched to after an add, named while it is not yet a row.
  const [addedName, setAddedName] = useState<string | null>(null);
  const rows = view ? rowsFor(view) : [];
  const busy = pending ?? (saving ? rows.find(row => sameChoice(row.choice, saving))?.id ?? 'saving' : null);
  const current = rows.find(row => sameChoice(row.choice, choice))?.id ?? 'default';
  const signIns = view?.signIns ?? [];
  // null: closed. A string: open, prefilled with that URL.
  const [adding, setAdding] = useState<string | null>(null);
  const showAdd = adding !== null || view?.connections.length === 0;
  const hasRows = (view?.connections.length ?? 0) > 0;

  function openAdd(url = '') {
    setError(null);
    setAdding(url);
  }

  // The add form closes on success, so a later failure is reported by the popover, which says the add itself worked.
  // The save and sign-in that follow an add hold the rows like any other pick.
  async function added(id: string, name: string) {
    setAdding(null);
    setPending(`c:${id}`);
    setAddedName(name);
    try {
      try {
        await choose(threadId, { kind: 'connection', id });
      } catch (cause) {
        if (!alive.current) return;
        // One message here instead of the store's generic one, which cannot name a connection the view does not have yet.
        if (threadId) dismissUnsaved(threadId);
        setError(`${name} was added, but this thread could not switch to it. ${message(cause)} Pick it to try again.`);
        return;
      }
      try {
        await rpc().call('signIn', { id, method: 'browser' });
      } catch (cause) {
        setError(`The connection was added, but its sign-in did not start. ${message(cause)}`);
      }
    } finally {
      setPending(null);
      setAddedName(null);
    }
  }

  // Row ids are fixed words or connection slugs ([a-z0-9-]), so the selector needs no escaping.
  const focusRow = useCallback((id: string) => {
    dialog.current?.querySelector<HTMLElement>(`[data-row="${id}"]`)?.focus({ preventScroll: true });
  }, []);
  // Focus the thread's current row once, when the state first arrives.
  const focused = useRef(false);
  useEffect(() => {
    if (!view || showSettings || focused.current) return;
    focused.current = true;
    focusRow(current);
  }, [view, showSettings, current, focusRow]);
  // Chromium closes a modal dialog itself on a repeated Escape, even when its cancel is prevented, as during an add.
  // Close the popover with it, so the store does not hold a closed dialog open. A removed dialog's late close is not one.
  useEffect(() => {
    const node = dialog.current;
    const closed = () => { if (node?.isConnected) onClose(); };
    node?.addEventListener('close', closed);
    return () => node?.removeEventListener('close', closed);
  }, [onClose]);
  // A control that unmounts while focused, such as the add form after a submit, leaves focus on the page body,
  // where the popover's keys do not reach. Put it back on a row.
  useEffect(() => {
    const node = dialog.current;
    if (!node?.open || (document.activeElement && document.activeElement !== document.body)) return;
    (node.querySelector<HTMLElement>(`[data-row="${current}"]`) ?? node.querySelector<HTMLElement>('[data-row]'))?.focus({ preventScroll: true });
  });

  async function pick(row: Row) {
    if (busy) return;
    setError(null);
    setPending(row.id);
    try {
      // A failed save reports itself through `unsaved`.
      try { await choose(threadId, row.choice); } catch { return; }
      if (row.connection?.status === 'signed-out') {
        try {
          await rpc().call('signIn', { id: row.connection.id, method: 'browser' });
        } catch (cause) {
          setError(`Could not start sign-in to ${row.connection.name}. ${message(cause)}`);
        }
        return;
      }
      if (alive.current) onClose();
    } finally {
      setPending(null);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (showSettings || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('.ex-signin, .ex-add')) return;
    const index = rows.findIndex(row => row.id === target.dataset['row']);
    const move = (step: number) => {
      const next = rows[(Math.max(index, 0) + step + rows.length) % rows.length];
      if (next) focusRow(next.id);
    };
    if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); move(-1); return; }
    if (event.key === 'a') { event.preventDefault(); if (!busy) openAdd(); return; }
    const byKey = rows.find(row => row.keycap === event.key);
    if (byKey) { event.preventDefault(); void pick(byKey); }
  }

  // Paste an MCP URL anywhere in the popover to start adding it.
  // Not while a pick or an add runs: a new add form would replace the running one and its outcome.
  function onPaste(event: ClipboardEvent<HTMLDialogElement>) {
    if (showSettings || busy || (event.target as HTMLElement).closest('input')) return;
    const text = event.clipboardData.getData('text/plain');
    if (!looksLikeMcpUrl(text)) return;
    event.preventDefault();
    openAdd(text.trim());
  }

  const title = showSettings ? 'Executor settings' : 'Executor connection';
  return <ChipPopover ref={dialog} aria-label={title} trigger={visibleChip} anchor={anchor} width={360}
    instant={instant} panelClassName="ex-panel" className="ex-dialog" onKeyDown={onKeyDown} onPaste={onPaste}
    // While the add runs, neither Escape nor a click outside closes the popover, so a stray press keeps the add's
    // outcome in view. The form's Close leaves on purpose; an add that ends after the popover closed switches nothing.
    onClose={pending === 'add' ? () => {} : onClose}
    // Escape leaves the add form first; with no connections the form is the whole popover.
    onEscape={pending === 'add' ? () => {} : !showSettings && adding !== null && hasRows ? () => setAdding(null) : undefined}>
    <header className="ex-header">
      <h2>{title}</h2>
      <button type="button" className="ex-button" aria-disabled={busy !== null || undefined} onClick={event => {
        if (busy) return;
        event.currentTarget.focus();
        setShowSettings(!showSettings);
      }}>{showSettings ? 'Back to connections' : 'Executor settings'}</button>
    </header>
    {showSettings ? <div className="ex-settings"><ExecutorSettings /></div> : <>
      {!view ? loadError
          ? <div className="ex-empty ex-load-failed" role="alert">
            <span>Could not load connections. {loadError}</span>
            <button type="button" className="ex-button" aria-disabled={retrying || undefined} onClick={() => {
              if (retrying) return;
              setRetrying(true);
              void refresh().finally(() => setRetrying(false));
            }}>{retrying ? 'Trying again…' : 'Try again'}</button>
          </div>
          : <p className="ex-empty">Loading…</p>
        : view.connections.length === 0 ? <p className="ex-empty">No connections yet. Add one from Executor's Connect page.</p>
        : <section className="ex-rows" aria-label="Connections">
          {rows.map(row => <button key={row.id} type="button" className="ex-row" data-row={row.id}
            aria-pressed={row.id === current} aria-busy={row.id === busy || undefined}
            aria-disabled={busy !== null && row.id !== busy ? true : undefined} onClick={() => void pick(row)}>
            {row.keycap ? <kbd>{row.keycap}</kbd> : <span aria-hidden />}
            <span className="ex-row-label">{row.label}</span>
            <span className="ex-row-aside" data-warn={row.connection && (row.connection.status !== 'signed-in' || view.errors[row.connection.id]) ? '' : undefined}
              data-error={row.aside === 'error' ? '' : undefined}>
              {row.id === busy ? 'saving…' : row.aside}{row.id === current && <span className="ex-check" aria-hidden> ✓</span>}
            </span>
          </button>)}
          {!showAdd && <button type="button" className="ex-row" data-row="add" aria-disabled={busy !== null || undefined}
            onClick={() => { if (!busy) openAdd(); }}>
            <kbd>a</kbd><span className="ex-row-label">Add connection…</span><span className="ex-row-aside">or paste a URL</span>
          </button>}
        </section>}
      {addedName && pending && !rows.some(row => row.id === pending) &&
        <p className="ex-empty" role="status">Switching to {addedName} and starting its sign-in…</p>}
      {view && showAdd && <AddForm key={adding ?? ''} initialUrl={adding ?? ''} count={view.connections.length}
        onBusy={next => setPending(next ? 'add' : null)} onAdded={added} onClose={onClose} onLost={text => reportUnsaved(threadId, text)} />}
      {signIns.map(signIn => <SignInPanel key={signIn.id} signIn={signIn}
        name={view?.connections.find(c => c.id === signIn.id)?.name ?? signIn.id} />)}
      {Object.entries(view?.errors ?? {}).map(([id, text]) => <p key={id} className="ex-error" role="alert">
        {view?.connections.find(c => c.id === id)?.name ?? id}: {text}
      </p>)}
      {unsaved && <p className="ex-error" role="alert">{unsaved}</p>}
      {error && <p className="ex-error" role="alert">{error}</p>}
      <footer className="ex-footer">
        {hasRows && pending !== 'add' && <span className="ex-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> choose <kbd>esc</kbd> close</span>}
        <span>{threadId ? "Applies to this thread's next Executor call." : 'Applies before the agent starts. Off disables Executor tools.'}</span>
      </footer>
    </>}
  </ChipPopover>;
}
