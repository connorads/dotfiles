import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import type { ConnectionView, StateView } from './contracts.ts';
import { SignInPanel } from './sign-in.tsx';
import { choose, message, rpc, visibleChip, type Anchor, type Choice } from './store.ts';

type Row = { id: string; keycap: string; choice: Choice; label: ReactNode; aside?: ReactNode; connection?: ConnectionView };

function rowsFor(view: StateView): Row[] {
  const fallback = view.connections.find(c => c.isDefault);
  return [
    { id: 'default', keycap: 'd', choice: { kind: 'default' }, label: 'Default', aside: fallback?.name ?? 'none' },
    ...view.connections.slice(0, 9).map((connection, index): Row => ({
      id: `c:${connection.id}`, keycap: String(index + 1), choice: { kind: 'connection', id: connection.id },
      label: connection.name, connection,
      aside: connection.status === 'signed-in' ? undefined : connection.status === 'signing-in' ? 'signing in' : 'sign in',
    })),
    { id: 'off', keycap: 'o', choice: { kind: 'off' }, label: 'Off', aside: 'no Executor tools' },
  ];
}

const sameChoice = (a: Choice, b: Choice | undefined) =>
  a.kind === (b?.kind ?? 'default') && (a.kind !== 'connection' || (b?.kind === 'connection' && b.id === a.id));

export function ExecutorPopover({ view, threadId, choice, anchor, instant, onClose }: {
  view: StateView | null; threadId: string | null; choice: Choice | undefined; anchor: Anchor; instant: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = view ? rowsFor(view) : [];
  const current = rows.find(row => sameChoice(row.choice, choice))?.id ?? 'default';
  const signIns = view?.signIns ?? [];

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

  async function pick(row: Row) {
    if (!threadId) return;
    setError(null);
    try {
      await choose(threadId, row.choice);
      if (row.connection && row.connection.status === 'signed-out') {
        await rpc().call('signIn', { id: row.connection.id, method: 'browser' });
        return;
      }
      onClose();
    } catch (cause) {
      setError(message(cause));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('.ex-signin')) return;
    const index = rows.findIndex(row => row.id === target.dataset['row']);
    const move = (step: number) => {
      const next = rows[(Math.max(index, 0) + step + rows.length) % rows.length];
      if (next) focusRow(next.id);
    };
    if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); move(-1); return; }
    const byKey = rows.find(row => row.keycap === event.key);
    if (byKey) { event.preventDefault(); void pick(byKey); }
  }

  return <ChipPopover ref={dialog} aria-label="Executor connection" trigger={visibleChip} anchor={anchor} width={360}
    instant={instant} panelClassName="ex-panel" className="ex-dialog" onKeyDown={onKeyDown} onClose={onClose}>
    <header className="ex-header">
      <h2>Executor connection</h2>
      <span className="ex-muted">{threadId ? 'for this thread' : 'open a thread to choose'}</span>
    </header>
    {!view ? <p className="ex-empty">Loading…</p>
      : view.connections.length === 0 ? <p className="ex-empty">No connections yet. Add one in Settings → Executor.</p>
      : <section className="ex-rows" aria-label="Connections">
        {rows.map(row => <button key={row.id} type="button" className="ex-row" data-row={row.id}
          aria-pressed={row.id === current} disabled={!threadId} onClick={() => void pick(row)}>
          <kbd>{row.keycap}</kbd>
          <span className="ex-row-label">{row.label}</span>
          <span className="ex-row-aside" data-warn={row.connection && row.connection.status !== 'signed-in' ? '' : undefined}>
            {row.aside}{row.id === current && <span className="ex-check" aria-hidden> ✓</span>}
          </span>
        </button>)}
      </section>}
    {signIns.map(signIn => <SignInPanel key={signIn.id} signIn={signIn}
      name={view?.connections.find(c => c.id === signIn.id)?.name ?? signIn.id} />)}
    {Object.entries(view?.errors ?? {}).map(([id, text]) => <p key={id} className="ex-error" role="alert">
      {view?.connections.find(c => c.id === id)?.name ?? id}: {text}
    </p>)}
    {error && <p className="ex-error" role="alert">{error}</p>}
    <footer className="ex-footer">
      <span className="ex-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> choose <kbd>esc</kbd> close</span>
      <span>A change applies to this thread's next Executor call. Manage connections in Settings → Executor.</span>
    </footer>
  </ChipPopover>;
}
