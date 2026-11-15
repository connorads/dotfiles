import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import { AddForm, looksLikeMcpUrl } from './add-form.tsx';
import type { ConnectionView, StateView } from './contracts.ts';
import { SignInPanel } from './sign-in.tsx';
import { choose, message, refresh, rpc, visibleChip, type Anchor, type Choice } from './store.ts';

type Row = { id: string; keycap: string; choice: Choice; label: ReactNode; aside?: ReactNode; connection?: ConnectionView };

function rowsFor(view: StateView): Row[] {
  const fallback = view.connections.find(c => c.isDefault);
  return [
    { id: 'default', keycap: 'd', choice: { kind: 'default' }, label: 'Default', aside: fallback?.name ?? 'none' },
    // Keys 1-9 reach the first nine; later connections are still rows, picked by arrows or pointer.
    ...view.connections.map((connection, index): Row => ({
      id: `c:${connection.id}`, keycap: index < 9 ? String(index + 1) : '', choice: { kind: 'connection', id: connection.id },
      label: connection.name, connection,
      aside: view.errors[connection.id] ? 'error' : connection.status === 'signed-in' ? undefined : connection.status === 'signing-in' ? 'signing in' : 'sign in',
    })),
    { id: 'off', keycap: 'o', choice: { kind: 'off' }, label: 'Off', aside: 'no Executor tools' },
  ];
}

const sameChoice = (a: Choice, b: Choice | undefined) =>
  a.kind === (b?.kind ?? 'default') && (a.kind !== 'connection' || (b?.kind === 'connection' && b.id === a.id));

/** unsaved: why this thread's last pick failed, which may outlive the popover that made it. */
export function ExecutorPopover({ view, loadError, threadId, choice, unsaved, anchor, instant, onClose }: {
  view: StateView | null; loadError: string | null; threadId: string | null; choice: Choice | undefined; unsaved: string | null;
  anchor: Anchor; instant: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // A save outlives a popover closed mid-save; it must not close the next one.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  // The row whose save is in flight; further picks wait for it so one press sends one request.
  const [pending, setPending] = useState<string | null>(null);
  const rows = view ? rowsFor(view) : [];
  const current = rows.find(row => sameChoice(row.choice, choice))?.id ?? 'default';
  const signIns = view?.signIns ?? [];
  // null: closed. A string: open, prefilled with that URL.
  const [adding, setAdding] = useState<string | null>(null);
  const showAdd = adding !== null || view?.connections.length === 0;

  function openAdd(url = '') {
    setError(null);
    setAdding(url);
  }

  // The add form closes on success, so a later failure is reported by the popover, which says the add itself worked.
  async function added(id: string) {
    setAdding(null);
    try {
      await choose(threadId, { kind: 'connection', id });
    } catch {
      setError('The connection was added. Its sign-in has not started.');
      return;
    }
    try {
      await rpc().call('signIn', { id, method: 'browser' });
    } catch (cause) {
      setError(`The connection was added, but its sign-in did not start. ${message(cause)}`);
    }
  }

  // Row ids are fixed words or connection slugs ([a-z0-9-]), so the selector needs no escaping.
  const focusRow = useCallback((id: string) => {
    dialog.current?.querySelector<HTMLElement>(`[data-row="${id}"]`)?.focus({ preventScroll: true });
  }, []);
  // Focus the thread's current row once, when the state first arrives.
  const focused = useRef(false);
  useEffect(() => {
    if (!view || focused.current) return;
    focused.current = true;
    focusRow(current);
  }, [view, current, focusRow]);
  // A control that unmounts while focused, such as the add form after a submit, leaves focus on the page body,
  // where the popover's keys do not reach. Put it back on a row.
  useEffect(() => {
    const node = dialog.current;
    if (!node?.open || (document.activeElement && document.activeElement !== document.body)) return;
    (node.querySelector<HTMLElement>(`[data-row="${current}"]`) ?? node.querySelector<HTMLElement>('[data-row]'))?.focus({ preventScroll: true });
  });

  async function pick(row: Row) {
    if (pending) return;
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
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('.ex-signin, .ex-add')) return;
    const index = rows.findIndex(row => row.id === target.dataset['row']);
    const move = (step: number) => {
      const next = rows[(Math.max(index, 0) + step + rows.length) % rows.length];
      if (next) focusRow(next.id);
    };
    if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); move(-1); return; }
    if (event.key === 'a') { event.preventDefault(); if (!pending) openAdd(); return; }
    const byKey = rows.find(row => row.keycap === event.key);
    if (byKey) { event.preventDefault(); void pick(byKey); }
  }

  // Paste an MCP URL anywhere in the popover to start adding it.
  function onPaste(event: ClipboardEvent<HTMLDialogElement>) {
    if ((event.target as HTMLElement).closest('input')) return;
    const text = event.clipboardData.getData('text/plain');
    if (!looksLikeMcpUrl(text)) return;
    event.preventDefault();
    openAdd(text.trim());
  }

  return <ChipPopover ref={dialog} aria-label="Executor connection" trigger={visibleChip} anchor={anchor} width={360}
    instant={instant} panelClassName="ex-panel" className="ex-dialog" onKeyDown={onKeyDown} onPaste={onPaste} onClose={onClose}>
    <header className="ex-header">
      <h2>Executor connection</h2>
      <span className="ex-muted">{threadId ? 'for this thread' : 'before the first message'}</span>
    </header>
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
          aria-pressed={row.id === current} aria-busy={row.id === pending || undefined}
          aria-disabled={pending !== null && row.id !== pending ? true : undefined} onClick={() => void pick(row)}>
          {row.keycap ? <kbd>{row.keycap}</kbd> : <span aria-hidden />}
          <span className="ex-row-label">{row.label}</span>
          <span className="ex-row-aside" data-warn={row.connection && row.connection.status !== 'signed-in' ? '' : undefined}>
            {row.id === pending ? 'saving…' : row.aside}{row.id === current && <span className="ex-check" aria-hidden> ✓</span>}
          </span>
        </button>)}
        {!showAdd && <button type="button" className="ex-row" data-row="add" aria-disabled={pending !== null || undefined}
          onClick={() => { if (!pending) openAdd(); }}>
          <kbd>a</kbd><span className="ex-row-label">Add connection…</span><span className="ex-row-aside">or paste a URL</span>
        </button>}
      </section>}
    {view && showAdd && <AddForm key={adding ?? ''} initialUrl={adding ?? ''} count={view.connections.length} onAdded={added} />}
    {signIns.map(signIn => <SignInPanel key={signIn.id} signIn={signIn}
      name={view?.connections.find(c => c.id === signIn.id)?.name ?? signIn.id} />)}
    {Object.entries(view?.errors ?? {}).map(([id, text]) => <p key={id} className="ex-error" role="alert">
      {view?.connections.find(c => c.id === id)?.name ?? id}: {text}
    </p>)}
    {unsaved && <p className="ex-error" role="alert">{unsaved}</p>}
    {error && <p className="ex-error" role="alert">{error}</p>}
    <footer className="ex-footer">
      <span className="ex-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> choose <kbd>esc</kbd> close</span>
      <span>{threadId ? "Applies to this thread's next Executor call." : 'Applies before the agent starts. Off disables Executor tools.'}</span>
      <span>Sign out, change the default or remove in Settings → Executor.</span>
    </footer>
  </ChipPopover>;
}
