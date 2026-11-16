import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import type { ConnectionView, SignInView } from './contracts.ts';
import { SignInPanel } from './sign-in.tsx';
import { message, refresh, rpc, useExecutor } from './store.ts';

const STATUS: Record<ConnectionView['status'], string> = {
  'signed-in': 'Signed in',
  'signed-out': 'Signed out',
  'signing-in': 'Waiting for approval',
};

export function ExecutorSettings() {
  const { view, loadError } = useExecutor();
  const [retrying, setRetrying] = useState(false);
  const section = useRef<HTMLDivElement>(null);
  // The row whose action succeeded. Its buttons change with the refreshed state (Sign out becomes Sign in,
  // Make default goes, a removed row goes), which leaves focus on the page body; put it back at that place in the list.
  const done = useRef<number | null>(null);
  useEffect(() => {
    const at = done.current;
    if (at === null) return;
    const active = document.activeElement;
    if (active && active !== document.body) {
      if (!section.current?.querySelector('ul')?.contains(active)) done.current = null;
      return;
    }
    done.current = null;
    const rows = section.current?.querySelectorAll('ul > li');
    const row = rows?.[Math.min(at, rows.length - 1)];
    const target = row?.querySelector<HTMLElement>('.ex-signin a') ?? row?.querySelector<HTMLElement>('button')
      ?? section.current?.querySelector<HTMLElement>('input[aria-label="Connection URL"]');
    target?.focus({ preventScroll: true });
  });
  if (!view && loadError) return <div className="flex flex-wrap items-center gap-2" role="alert">
    <p className="text-sm text-destructive">Could not load connections. {loadError}</p>
    <Button size="sm" variant="ghost" aria-disabled={retrying || undefined} onClick={() => {
      if (retrying) return;
      setRetrying(true);
      void refresh().finally(() => setRetrying(false));
    }}>{retrying ? 'Trying again…' : 'Try again'}</Button>
  </div>;
  if (!view) return <p className="text-sm text-muted-foreground" role="status">Loading connections…</p>;

  return <div ref={section} className="w-full space-y-5">
    <div>
      <h3 className="text-sm font-medium text-foreground">Connections</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Each is one of your Executor scoped connections. Threads use the default unless you pick another from the
        Executor chip in the thread header (⌥E).
      </p>
      {!view.toolsReady && view.connections.length > 0 &&
        <p className="mt-1 text-xs text-muted-foreground">Tools appear in new threads after the first sign-in.</p>}
    </div>

    {view.connections.length === 0
      ? <p className="text-sm text-muted-foreground">No connections yet.</p>
      : <ul aria-label="Connections">
        {view.connections.map((connection, index) => <ConnectionRow key={connection.id} connection={connection}
          signIn={view.signIns.find(s => s.id === connection.id)} error={view.errors[connection.id]}
          onDone={() => { done.current = index; }} />)}
      </ul>}

    <AddConnection count={view.connections.length} />
  </div>;
}

/**
 * One action at a time per row: buttons wait while a request is in flight, and its failure shows in the row.
 * They use aria-disabled, not disabled, because a disabled button drops keyboard focus to the page body.
 */
function ConnectionRow({ connection, signIn, error, onDone }: {
  connection: ConnectionView;
  signIn: SignInView | undefined;
  error: string | undefined;
  onDone: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const run = (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    work().then(onDone, cause => setFailure(message(cause))).finally(() => setBusy(false));
  };
  const id = { id: connection.id };
  const waiting = busy || undefined;
  return <li className="ex-connection-row px-2 py-2 hover:bg-accent/50" aria-busy={waiting}>
    <div className="ex-connection">
      <div className="ex-connection-name min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="truncate">{connection.name}</span>
          {connection.isDefault && <span className="ex-badge">Default</span>}
        </div>
        <div className="ex-connection-url truncate text-xs text-muted-foreground" title={connection.url}>
          <span data-status={connection.status} className="ex-status">{STATUS[connection.status]}</span> · {connection.url}
        </div>
      </div>
      {connection.status === 'signed-out' &&
        <>
          <Button size="sm" aria-disabled={waiting} onClick={() => run(() => rpc().call('signIn', { ...id, method: 'browser' }))}>Sign in</Button>
          <Button size="sm" variant="ghost" aria-disabled={waiting}
            onClick={() => run(() => rpc().call('signIn', { ...id, method: 'device' }))}>Use a code</Button>
        </>}
      {connection.status === 'signed-in' &&
        <Button size="sm" variant="ghost" aria-disabled={waiting} onClick={() => run(() => rpc().call('signOut', id))}>Sign out</Button>}
      {!connection.isDefault &&
        <Button size="sm" variant="ghost" aria-disabled={waiting} onClick={() => run(() => rpc().call('setDefault', id))}>Make default</Button>}
      <Button size="sm" variant={confirmRemove ? 'destructive' : 'ghost'} aria-disabled={waiting}
        onBlur={() => setConfirmRemove(false)}
        onClick={() => {
          if (busy) return;
          if (!confirmRemove) { setConfirmRemove(true); return; }
          run(() => rpc().call('remove', id).finally(() => setConfirmRemove(false)));
        }}>{confirmRemove ? 'Confirm remove' : 'Remove'}</Button>
    </div>
    {signIn && <SignInPanel signIn={signIn} name={connection.name} />}
    {error && <p className="mt-1 text-xs text-destructive" role="alert">{error}</p>}
    {failure && <p className="mt-1 text-xs text-destructive" role="alert">{failure}</p>}
  </li>;
}

/**
 * The name is optional, as in the popover's form: an empty one becomes the next "Connection N".
 * Every outcome shows under the form and clears when the URL changes.
 */
function AddConnection({ count }: { count: number }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fallbackName = `Connection ${count + 1}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !url.trim()) return;
    setBusy(true);
    setProblem(null);
    const named = name.trim() || fallbackName;
    try {
      const result = await rpc().call('add', { name: named, url: url.trim() });
      if (!result.ok) { setProblem(result.message); return; }
      setName('');
      setUrl('');
      try {
        await rpc().call('signIn', { id: result.id, method: 'browser' });
      } catch (cause) {
        setProblem(`${named} was added, but its sign-in did not start. ${message(cause)} Use Sign in on its row.`);
      }
    } catch (cause) {
      setProblem(message(cause));
    } finally {
      setBusy(false);
    }
  }

  // Inputs are read-only while the add runs: a success clears them, so edits made meanwhile would be lost.
  return <form className="border-t border-border/60 pt-4" onSubmit={event => void submit(event)} aria-label="Add connection">
    <h3 className="text-sm font-medium text-foreground">Add connection</h3>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
      In Executor, open Connect, create or pick a scoped connection, and copy its MCP URL.
    </p>
    <div className="mt-2 flex flex-wrap gap-2">
      <Input aria-label="Connection name" placeholder={fallbackName} className="w-44 shrink-0"
        maxLength={60} readOnly={busy} value={name} onChange={event => setName(event.target.value)} />
      <Input aria-label="Connection URL" placeholder="https://mcp.executor.sh/mcp?connection=…" className="min-w-64 flex-1"
        readOnly={busy} value={url} onChange={event => { setUrl(event.target.value); setProblem(null); }} required />
      {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page body. */}
      <Button type="submit" size="sm" className="ex-add-submit h-9" aria-disabled={busy || !url.trim() || undefined}>{busy ? 'Adding…' : 'Add and sign in'}</Button>
    </div>
    {problem && <p className="mt-1 text-xs text-destructive" role="alert">{problem}</p>}
  </form>;
}
