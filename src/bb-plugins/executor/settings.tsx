import { useState, type FormEvent } from 'react';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import type { ConnectionView, SignInView } from './contracts.ts';
import { SignInPanel } from './sign-in.tsx';
import { message, rpc, useExecutor } from './store.ts';

const STATUS: Record<ConnectionView['status'], string> = {
  'signed-in': 'Signed in',
  'signed-out': 'Signed out',
  'signing-in': 'Waiting for approval',
};

export function ExecutorSettings() {
  const { view } = useExecutor();
  const [error, setError] = useState<string | null>(null);
  const run = (work: Promise<unknown>) => {
    setError(null);
    work.catch(cause => setError(message(cause)));
  };

  if (!view) return <p className="text-sm text-muted-foreground" role="status">Loading connections…</p>;

  return <div className="w-full space-y-5">
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
      : <ul className="space-y-1" aria-label="Connections">
        {view.connections.map(connection => <ConnectionRow key={connection.id} connection={connection}
          signIn={view.signIns.find(s => s.id === connection.id)} error={view.errors[connection.id]} run={run} />)}
      </ul>}

    <AddConnection run={run} />
    {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
  </div>;
}

function ConnectionRow({ connection, signIn, error, run }: {
  connection: ConnectionView;
  signIn: SignInView | undefined;
  error: string | undefined;
  run: (work: Promise<unknown>) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const id = { id: connection.id };
  return <li className="rounded-md px-2 py-2 hover:bg-accent/50">
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="truncate">{connection.name}</span>
          {connection.isDefault && <span className="ex-badge">Default</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground" title={connection.url}>
          <span data-status={connection.status} className="ex-status">{STATUS[connection.status]}</span> · {connection.url}
        </div>
      </div>
      {connection.status === 'signed-out' &&
        <Button size="sm" onClick={() => run(rpc().call('signIn', id))}>Sign in</Button>}
      {connection.status === 'signed-in' &&
        <Button size="sm" variant="ghost" onClick={() => run(rpc().call('signOut', id))}>Sign out</Button>}
      {!connection.isDefault &&
        <Button size="sm" variant="ghost" onClick={() => run(rpc().call('setDefault', id))}>Make default</Button>}
      <Button size="sm" variant={confirmRemove ? 'destructive' : 'ghost'}
        onBlur={() => setConfirmRemove(false)}
        onClick={() => {
          if (!confirmRemove) { setConfirmRemove(true); return; }
          run(rpc().call('remove', id));
        }}>{confirmRemove ? 'Confirm remove' : 'Remove'}</Button>
    </div>
    {signIn && <SignInPanel signIn={signIn} name={connection.name} />}
    {error && <p className="mt-1 text-xs text-destructive" role="alert">{error}</p>}
  </li>;
}

function AddConnection({ run }: { run: (work: Promise<unknown>) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    run(rpc().call('add', { name: name.trim(), url: url.trim() }).then(async result => {
      if (!result.ok) { setProblem(result.message); return; }
      setName('');
      setUrl('');
      await rpc().call('signIn', { id: result.id });
    }).finally(() => setBusy(false)));
  }

  return <form className="border-t border-border/60 pt-4" onSubmit={submit} aria-label="Add connection">
    <h3 className="text-sm font-medium text-foreground">Add connection</h3>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
      In Executor, open Connect, create or pick a scoped connection, and copy its MCP URL.
    </p>
    <div className="mt-2 flex flex-wrap gap-2">
      <Input aria-label="Connection name" placeholder="Name, e.g. Coding" className="w-44 shrink-0" maxLength={60}
        value={name} onChange={event => setName(event.target.value)} required />
      <Input aria-label="Connection URL" placeholder="https://mcp.executor.sh/mcp?connection=…" className="min-w-64 flex-1"
        value={url} onChange={event => { setUrl(event.target.value); setProblem(null); }} required />
      <Button type="submit" size="sm" className="h-9" disabled={busy || !name.trim() || !url.trim()}>Add and sign in</Button>
    </div>
    {problem && <p className="mt-1 text-xs text-destructive" role="alert">{problem}</p>}
  </form>;
}
