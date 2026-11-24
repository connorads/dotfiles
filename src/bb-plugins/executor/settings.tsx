import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { UrlLink } from '@get-bb/plugin-sdk/app';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import type { ConnectionView, ProjectView, ScopedChoiceView, SignInView } from './contracts.ts';
import { ShimmerText } from './shimmer.tsx';
import { SignInPanel } from './sign-in.tsx';
import {
  checkAll, checkOne, dotStateFor, globalDefaultOf, healthKind, message, refresh, rpc, setGlobalDefault,
  setProjectChoice, timeAgo, useExecutor, useNow, type Choice,
} from './store.ts';

const STATUS: Record<ConnectionView['status'], string> = {
  'signed-in': 'Signed in',
  'signed-out': 'Signed out',
  'signing-in': 'Waiting for approval',
};

const MAX_SETTINGS_APPS = 10;

function choiceValue(choice: ScopedChoiceView | null | undefined): string {
  if (!choice) return 'inherit';
  return choice.kind === 'off' ? 'off' : `c:${choice.id}`;
}

function parseChoiceValue(raw: string): Choice {
  if (raw === 'inherit') return { kind: 'default' };
  if (raw === 'off') return { kind: 'off' };
  return { kind: 'connection', id: raw.slice(2) };
}

export function ExecutorSettings() {
  const { view, loadError } = useExecutor();
  const [retrying, setRetrying] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const section = useRef<HTMLDivElement>(null);
  const checkedOnMount = useRef(false);
  // Lazily verify stale signed-in connections when Settings opens.
  useEffect(() => {
    if (!view || checkedOnMount.current) return;
    checkedOnMount.current = true;
    if (view.connections.some(c => c.status === 'signed-in')) void checkAll(false);
  }, [view]);
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

  const hasChecked = view?.connections.some(c => c.health?.checkedAt !== null) ?? false;
  const now = useNow(15_000, hasChecked);

  if (!view && loadError) return <div className="flex flex-wrap items-center gap-2" role="alert">
    <p className="text-sm text-destructive">Could not load connections. {loadError}</p>
    <Button size="sm" variant="ghost" aria-disabled={retrying || undefined} onClick={() => {
      if (retrying) return;
      setRetrying(true);
      void refresh().finally(() => setRetrying(false));
    }}>{retrying ? 'Trying again…' : 'Try again'}</Button>
  </div>;
  if (!view) return <p className="text-sm text-muted-foreground" role="status">Loading connections…</p>;

  const anySignedIn = view.connections.some(c => c.status === 'signed-in');
  const anyChecking = checkingAll || view.connections.some(c => c.health?.state === 'checking');
  const liveCount = view.connections.filter(c => healthKind(c, view.errors[c.id]) === 'ok').length;
  const attentionCount = view.connections.filter(c => {
    const k = healthKind(c, view.errors[c.id]);
    return k === 'reauth' || k === 'unreachable' || k === 'degraded' || k === 'error';
  }).length;
  const globalDefault = globalDefaultOf(view);
  const projects = [...(view.projects ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return <div ref={section} className="w-full space-y-5">
    <div className="ex-settings-head">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h3 className="text-sm font-medium text-foreground">Connections</h3>
          {view.connections.length > 0 && (liveCount > 0 || attentionCount > 0) && <span className="ex-summary-line">
            {liveCount > 0 && <span className="ex-summary-item" data-state="ok">
              <span className="ex-dot" data-state="ok" aria-hidden="true" />{liveCount} live
            </span>}
            {attentionCount > 0 && <span className="ex-summary-item" data-state="danger">
              <span className="ex-dot" data-state="danger" aria-hidden="true" />{attentionCount} need{attentionCount === 1 ? 's' : ''} attention
            </span>}
          </span>}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Threads use their own pick first, then their parent thread, then their project default, then the global default.
          Switch per thread or set a project default with ⌥E.
        </p>
        {!view.toolsReady && view.connections.length > 0 &&
          <p className="mt-1 text-xs text-muted-foreground">Tools appear in new threads after the first sign-in.</p>}
      </div>
      {anySignedIn && <Button size="sm" variant="outline" aria-disabled={anyChecking || undefined} onClick={() => {
        if (anyChecking) return;
        setCheckingAll(true);
        void checkAll(true).finally(() => setCheckingAll(false));
      }}><ShimmerText text={anyChecking ? 'Checking…' : 'Check all'} active={anyChecking} /></Button>}
    </div>

    {view.connections.length === 0
      ? <p className="text-sm text-muted-foreground">No connections yet.</p>
      : <ul className="ex-settings-list" aria-label="Connections">
        {view.connections.map((connection, index) => <ConnectionRow key={connection.id} connection={connection}
          signIn={view.signIns.find(s => s.id === connection.id)} error={view.errors[connection.id]}
          now={now} onDone={() => { done.current = index; }} />)}
      </ul>}

    {view.connections.length > 0 && <ProjectDefaultsSection
      connections={view.connections}
      globalDefault={globalDefault}
      projects={projects}
    />}

    <AddConnection count={view.connections.length} />
  </div>;
}

function ProjectDefaultsSection({ connections, globalDefault, projects }: {
  connections: readonly ConnectionView[];
  globalDefault: ScopedChoiceView | null;
  projects: readonly ProjectView[];
}) {
  const [saving, setSaving] = useState<ReadonlyMap<string, string>>(new Map());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const inFlight = useRef(new Set<string>());

  async function run(key: string, pendingValue: string, task: () => Promise<void>) {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setErrors(prev => { const next = new Map(prev); next.delete(key); return next; });
    setSaving(prev => new Map(prev).set(key, pendingValue));
    try {
      await task();
    } catch (cause) {
      setErrors(prev => new Map(prev).set(key, message(cause)));
    } finally {
      inFlight.current.delete(key);
      setSaving(prev => { const next = new Map(prev); next.delete(key); return next; });
    }
  }

  const globalLabel = globalDefault?.kind === 'connection'
    ? (connections.find(c => c.id === globalDefault.id)?.name ?? globalDefault.id)
    : 'Off';

  return <section className="ex-defaults-section border-t border-border/60 pt-4 space-y-4">
    <div className="ex-global-row">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium text-foreground">Global default</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Used when neither the thread nor its project sets a connection.</p>
      </div>
      <select className="ex-select" aria-label="Global default"
        value={saving.get('global') ?? (globalDefault ? choiceValue(globalDefault) : 'off')}
        aria-busy={saving.has('global') || undefined}
        onChange={event => {
          const val = event.target.value;
          const next: ScopedChoiceView = val === 'off' ? { kind: 'off' } : { kind: 'connection', id: val.slice(2) };
          void run('global', val, () => setGlobalDefault(next));
        }}>
        <option value="off">Off</option>
        {connections.map(c => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}
      </select>
    </div>
    {errors.has('global') && <p className="text-xs text-destructive" role="alert">Could not change global default. {errors.get('global')}</p>}

    {projects.length > 0 && <div>
      <h3 className="text-sm font-medium text-foreground">Project defaults</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Each project can default to its own scoped Executor connection or turn Executor off.</p>
      <table className="ex-projects-table mt-2" aria-label="Project defaults">
        <thead><tr><th>Project</th><th>Connection</th></tr></thead>
        <tbody>
          {projects.map(project => {
            const key = `project:${project.id}`;
            const currentValue = saving.get(key) ?? choiceValue(project.choice);
            return <tr key={project.id}>
              <td>
                <div className="truncate font-medium text-foreground">{project.name}</div>
                {errors.has(key) && <p className="mt-0.5 text-xs text-destructive" role="alert">{errors.get(key)}</p>}
              </td>
              <td>
                <select className="ex-select" aria-label={`${project.name} default connection`}
                  value={currentValue} aria-busy={saving.has(key) || undefined}
                  onChange={event => {
                    const val = event.target.value;
                    void run(key, val, () => setProjectChoice(project.id, parseChoiceValue(val)));
                  }}>
                  <option value="inherit">Inherit ({globalLabel})</option>
                  <option value="off">Off</option>
                  {connections.map(c => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}
                </select>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>}
  </section>;
}

/**
 * One action at a time per row: buttons wait while a request is in flight, and its failure shows in the row.
 * They use aria-disabled, not disabled, because a disabled button drops keyboard focus to the page body.
 */
function ConnectionRow({ connection, signIn, error, now, onDone }: {
  connection: ConnectionView;
  signIn: SignInView | undefined;
  error: string | undefined;
  now: number;
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
  const kind = healthKind(connection, error);
  const dotState = dotStateFor(kind);
  const health = connection.health;
  const isChecking = kind === 'checking';
  const apps = health?.apps ?? [];
  const visibleApps = apps.slice(0, MAX_SETTINGS_APPS);
  const hiddenCount = Math.max(0, apps.length - visibleApps.length);
  const toolText = health?.toolCount !== null && health?.toolCount !== undefined
    ? `${health.toolCount.toLocaleString()} tool${health.toolCount === 1 ? '' : 's'}`
    : null;
  const healthDetail = kind === 'checking' ? 'Checking…'
    : kind === 'reauth' ? 'Sign-in rejected'
    : kind === 'unreachable' ? 'Offline'
    : kind === 'degraded' ? 'App unavailable in Executor'
    : kind === 'ok' ? [toolText, health?.checkedAt ? timeAgo(health.checkedAt, now) : null].filter(Boolean).join(' · ')
    : null;
  const rowError = error ?? (kind === 'unreachable' || kind === 'reauth' || kind === 'degraded' ? health?.message : null);

  return <li className="ex-connection-row px-3 py-2.5 hover:bg-accent/40" aria-busy={waiting || isChecking || undefined}>
    <div className="ex-connection">
      <div className="ex-connection-name min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="ex-dot" data-state={dotState} aria-hidden="true" />
          <span className="truncate">{connection.name}</span>
          {connection.isDefault && <span className="ex-badge">Default</span>}
          {connection.approvalMode === 'browser' && <span className="ex-mode-tag">browser</span>}
        </div>
        <div className="ex-connection-url truncate text-xs text-muted-foreground" title={connection.url}>
          <span data-status={connection.status} data-health={kind} className="ex-status">{STATUS[connection.status]}</span>
          {healthDetail && <> · <span className="ex-health-detail" data-state={dotState}>{healthDetail}</span></>}
          {' '}· {connection.url}
        </div>
      </div>
      {connection.status === 'signed-out' &&
        <>
          <Button size="sm" aria-disabled={waiting} onClick={() => run(() => rpc().call('signIn', { ...id, method: 'browser' }))}>Sign in</Button>
          <Button size="sm" variant="ghost" aria-disabled={waiting}
            onClick={() => run(() => rpc().call('signIn', { ...id, method: 'device' }))}>Use a code</Button>
        </>}
      {connection.status === 'signed-in' &&
        <>
          <Button size="sm" variant="ghost" aria-disabled={waiting || isChecking || undefined}
            onClick={() => run(() => checkOne(connection.id, true))}>
            <ShimmerText text={isChecking ? 'Checking…' : 'Check'} active={isChecking} />
          </Button>
          <Button size="sm" variant="ghost" aria-disabled={waiting}
            onClick={() => run(() => rpc().call('signIn', { ...id, method: 'browser' }))}>Reconnect</Button>
          <Button size="sm" variant="ghost" aria-disabled={waiting} onClick={() => run(() => rpc().call('signOut', id))}>Sign out</Button>
        </>}
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
    {apps.length > 0 && <p className="ex-app-list ex-settings-apps">
      {visibleApps.map((app, idx) => <Fragment key={`${app.app}:${app.account ?? ''}`}>
        {idx > 0 && <span className="ex-sep" aria-hidden="true">·</span>}
        <span className="ex-app-item" data-ok={app.ok ? 'true' : 'false'}
          title={app.reason ?? (app.account ? `${app.app} — ${app.account}` : app.app)}>
          {!app.ok && <span className="ex-dot ex-app-dot" data-state="warn" aria-hidden="true" />}
          <span className="ex-app-name">{app.app}</span>
          {apps.length <= 2 && app.account && <span className="ex-app-account"> ({app.account})</span>}
        </span>
      </Fragment>)}
      {hiddenCount > 0 && <span className="ex-app-more"> +{hiddenCount} more</span>}
      {kind === 'degraded' && <>{' '}<UrlLink className="ex-inline-link" href={connection.webUrl}>Open Executor ↗</UrlLink></>}
    </p>}
    {signIn && <SignInPanel signIn={signIn} name={connection.name} />}
    {rowError && <p className="mt-1.5 text-xs text-destructive" role="alert">{rowError}</p>}
    {failure && <p className="mt-1.5 text-xs text-destructive" role="alert">{failure}</p>}
  </li>;
}

/**
 * The name is optional, as in the popover's form: an empty one becomes the next "Connection N".
 * Every outcome shows under the form and clears when the URL changes.
 */
function AddConnection({ count }: { count: number }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [browserApprovals, setBrowserApprovals] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fallbackName = `Connection ${count + 1}`;

  function buildUrl(raw: string): string {
    const trimmed = raw.trim();
    if (!browserApprovals) return trimmed;
    const parsed = URL.parse(trimmed);
    if (!parsed) return trimmed;
    parsed.searchParams.set('elicitation_mode', 'browser');
    return parsed.href;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !url.trim()) return;
    setBusy(true);
    setProblem(null);
    const named = name.trim() || fallbackName;
    try {
      const result = await rpc().call('add', { name: named, url: buildUrl(url) });
      if (!result.ok) { setProblem(result.message); return; }
      setName('');
      setUrl('');
      setBrowserApprovals(false);
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
        readOnly={busy} value={url} onChange={event => {
          const next = event.target.value;
          setUrl(next);
          setProblem(null);
          if (next.includes('elicitation_mode=browser')) setBrowserApprovals(true);
        }} required />
      {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page body. */}
      <Button type="submit" size="sm" className="ex-add-submit h-9" aria-disabled={busy || !url.trim() || undefined}>{busy ? 'Adding…' : 'Add and sign in'}</Button>
    </div>
    <label className="ex-check-option">
      <input type="checkbox" checked={browserApprovals} disabled={busy} onChange={event => setBrowserApprovals(event.target.checked)} />
      <span>Use browser approval links (<code>elicitation_mode=browser</code>)</span>
    </label>
    {problem && <p className="mt-1 text-xs text-destructive" role="alert">{problem}</p>}
  </form>;
}
