import { Fragment, useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { UrlLink } from '@get-bb/plugin-sdk/app';
import { ChipPopover } from '@bb-plugins/chip';
import { AddForm, looksLikeMcpUrl } from './add-form.tsx';
import type { ConnectionView, OwnerResolutionView, ScopedChoiceView, StateView } from './contracts.ts';
import { ExecutorMark } from './mark.tsx';
import { useMorphHeight } from './motion.ts';
import { ExecutorSettings } from './settings.tsx';
import { ShimmerText } from './shimmer.tsx';
import { SignInPanel } from './sign-in.tsx';
import {
  checkAll, checkOne, choose, dismissUnsaved, dotStateFor, globalDefaultOf, healthKind, message, refresh, reportUnsaved,
  resolve, rpc, setProjectChoice, timeAgo, useNow, visibleChip, type Anchor, type Choice,
} from './store.ts';

type Row = {
  id: string;
  keycap: string;
  choice: Choice;
  label: ReactNode;
  aside?: ReactNode;
  asideWarn?: boolean;
  asideError?: boolean;
  shimmerAside?: boolean;
  dotState?: 'ok' | 'warn' | 'danger' | 'checking' | 'muted';
  connection?: ConnectionView;
  dividerBefore?: boolean;
};

const HOVER_REST_MS = 140;
const MAX_VISIBLE_APPS = 7;

function connectionAside(connection: ConnectionView, connError: string | undefined): { text?: string; warn?: boolean; error?: boolean; shimmer?: boolean } {
  const kind = healthKind(connection, connError);
  if (kind === 'signing-in') return { text: 'signing in', warn: true, shimmer: true };
  if (kind === 'reauth') return { text: 're-auth needed', warn: true, error: true };
  if (kind === 'signed-out') return { text: 'sign in', warn: true };
  if (kind === 'checking') return { text: 'checking…', shimmer: true };
  if (kind === 'unreachable') return { text: 'offline', warn: true, error: true };
  if (kind === 'degraded') {
    const broken = connection.health?.apps.filter(a => !a.ok).length ?? 1;
    return { text: `${broken} app issue${broken === 1 ? '' : 's'}`, warn: true };
  }
  if (kind === 'error') return { text: 'error', warn: true, error: true };
  if (kind === 'ok') {
    const apps = connection.health?.apps.length ?? 0;
    return { text: apps > 0 ? `${apps} app${apps === 1 ? '' : 's'}` : 'live' };
  }
  return {};
}

function rowsFor(view: StateView, projectId: string | null, owner: OwnerResolutionView | null): Row[] {
  const inherited = resolve(view, { kind: 'default' }, { projectId, owner });
  const project = projectId ? view.projects?.find(p => p.id === projectId) : undefined;
  const defaultLabel = owner ? 'Parent thread' : project?.choice ? 'Project default' : 'Default';
  const defaultAside = inherited.kind === 'connection' ? inherited.name : inherited.kind === 'off' ? 'off' : 'none';
  const defaultDot = inherited.kind === 'connection'
    ? dotStateFor(healthKind(inherited.connection, view.errors[inherited.connection.id]))
    : undefined;

  return [
    {
      id: 'default',
      keycap: 'd',
      choice: { kind: 'default' },
      label: defaultLabel,
      aside: defaultAside,
      dotState: defaultDot,
    },
    // Keys 1-9 reach the first nine; later connections are still rows, picked by arrows or pointer.
    ...view.connections.map((connection, index): Row => {
      const aside = connectionAside(connection, view.errors[connection.id]);
      return {
        id: `c:${connection.id}`,
        keycap: index < 9 ? String(index + 1) : '',
        choice: { kind: 'connection', id: connection.id },
        label: connection.name,
        connection,
        aside: aside.text,
        asideWarn: aside.warn,
        asideError: aside.error,
        shimmerAside: aside.shimmer,
        dotState: dotStateFor(healthKind(connection, view.errors[connection.id])),
      };
    }),
    { id: 'off', keycap: 'o', choice: { kind: 'off' }, label: 'Off', aside: 'no Executor tools', dividerBefore: true },
  ];
}

const sameChoice = (a: Choice, b: Choice | undefined) =>
  a.kind === (b?.kind ?? 'default') && (a.kind !== 'connection' || (b?.kind === 'connection' && b.id === a.id));

const sameScoped = (a: ScopedChoiceView | null | undefined, b: ScopedChoiceView | null | undefined) =>
  Boolean(a && b && a.kind === b.kind && (a.kind !== 'connection' || (b.kind === 'connection' && a.id === b.id)));

/**
 * unsaved: why this thread's last pick failed, which may outlive the popover that made it.
 * saving: this thread's pick whose save is in flight, which may have been made by a popover that has closed since.
 */
export function ExecutorPopover({ view, loadError, threadId, projectId, choice, owner, saving, unsaved, anchor, instant, onClose }: {
  view: StateView | null;
  loadError: string | null;
  threadId: string | null;
  projectId: string | null;
  choice: Choice | undefined;
  owner: OwnerResolutionView | null;
  saving: Choice | undefined;
  unsaved: string | null;
  anchor: Anchor;
  instant: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const rowsBox = useRef<HTMLElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [inspectedRow, setInspectedRow] = useState<string | null>(null);
  // A save outlives a popover closed mid-save; it must not close the next one.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; clearTimeout(hoverTimer.current); };
  }, []);
  // Lazily check stale signed-in connections once when the popover opens.
  const checkedOnOpen = useRef(false);
  useEffect(() => {
    if (!view || checkedOnOpen.current) return;
    checkedOnOpen.current = true;
    if (view.connections.some(c => c.status === 'signed-in')) void checkAll(false);
  }, [view]);

  // The row whose save is in flight, or 'add' while an add runs; further picks wait for it so one press sends one request.
  const [pending, setPending] = useState<string | null>(null);
  // The connection being switched to after an add, named while it is not yet a row.
  const [addedName, setAddedName] = useState<string | null>(null);
  const rows = view ? rowsFor(view, projectId, owner) : [];
  const busy = pending ?? (saving ? rows.find(row => sameChoice(row.choice, saving))?.id ?? 'saving' : null);
  const current = rows.find(row => sameChoice(row.choice, choice))?.id ?? 'default';
  const signIns = view?.signIns ?? [];
  // null: closed. A string: open, prefilled with that URL.
  const [adding, setAdding] = useState<string | null>(null);
  const showAdd = adding !== null || view?.connections.length === 0;
  const hasRows = (view?.connections.length ?? 0) > 0;
  const anySignedIn = view?.connections.some(c => c.status === 'signed-in') ?? false;
  const anyChecking = checkingAll || (view?.connections.some(c => c.health?.state === 'checking') ?? false);
  const hasAnyChecked = view?.connections.some(c => c.health?.checkedAt !== null) ?? false;
  const now = useNow(15_000, hasAnyChecked);

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

  async function startSignIn(connection: ConnectionView, method: 'browser' | 'device') {
    if (actionBusy || busy) return;
    setError(null);
    setActionBusy(`signin:${connection.id}`);
    try {
      await rpc().call('signIn', { id: connection.id, method });
    } catch (cause) {
      setError(`Could not start sign-in to ${connection.name}. ${message(cause)}`);
    } finally {
      setActionBusy(null);
    }
  }

  async function runCheckAll() {
    if (anyChecking) return;
    setCheckingAll(true);
    try { await checkAll(true); } finally { if (alive.current) setCheckingAll(false); }
  }

  async function runCheckOne(id: string) {
    if (actionBusy) return;
    setActionBusy(`check:${id}`);
    try { await checkOne(id, true); } finally { if (alive.current) setActionBusy(null); }
  }

  // Resolve which connection the bottom inspector tray previews.
  const activeInspectId = inspectedRow ?? current;
  const inherited = resolve(view, { kind: 'default' }, { projectId, owner });
  const inspectedConnection: ConnectionView | null = (() => {
    if (!view || activeInspectId === 'off' || activeInspectId === 'add') return null;
    if (activeInspectId === 'default') return inherited.kind === 'connection' ? inherited.connection : null;
    if (activeInspectId.startsWith('c:')) {
      const id = activeInspectId.slice(2);
      return view.connections.find(c => c.id === id) ?? null;
    }
    return inherited.kind === 'connection' ? inherited.connection : null;
  })();

  // Project default target (`p` shortcut): applies the inspected connection (or Off) as this project's default.
  const project = projectId ? view?.projects?.find(p => p.id === projectId) : undefined;
  const projectTarget: { choice: ScopedChoiceView; label: string } | null = (() => {
    if (!projectId || !view || !hasRows) return null;
    if (activeInspectId === 'off') return { choice: { kind: 'off' }, label: 'Off' };
    if (inspectedConnection) return { choice: { kind: 'connection', id: inspectedConnection.id }, label: inspectedConnection.name };
    const fallback = globalDefaultOf(view);
    if (fallback?.kind === 'connection') {
      const found = view.connections.find(c => c.id === fallback.id);
      if (found) return { choice: fallback, label: found.name };
    }
    return null;
  })();
  const isAlreadyProjectDefault = Boolean(projectTarget && sameScoped(project?.choice, projectTarget.choice));

  async function toggleProjectDefault() {
    if (!projectId || !projectTarget || actionBusy || busy) return;
    setError(null);
    setActionBusy('project');
    try {
      const next: Choice = isAlreadyProjectDefault ? { kind: 'default' } : projectTarget.choice;
      await setProjectChoice(projectId, next);
    } catch (cause) {
      setError(`Could not update this project's default. ${message(cause)}`);
    } finally {
      if (alive.current) setActionBusy(null);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (showSettings || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('.ex-signin, .ex-add')) return;
    clearTimeout(hoverTimer.current);
    rowsBox.current?.setAttribute('data-keys', '');
    const index = rows.findIndex(row => row.id === target.dataset['row']);
    const move = (step: number) => {
      const next = index < 0
        ? rows[step > 0 ? 0 : rows.length - 1]
        : rows[(index + step + rows.length) % rows.length];
      if (next) focusRow(next.id);
    };
    if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); move(-1); return; }
    if (event.key === 'a') { event.preventDefault(); if (!busy) openAdd(); return; }
    if (event.key === 'c' && anySignedIn) { event.preventDefault(); void runCheckAll(); return; }
    if (event.key === 'p' && projectTarget && !busy) { event.preventDefault(); void toggleProjectDefault(); return; }
    if (event.key === 'r' && inspectedConnection && !busy) {
      event.preventDefault();
      const kind = healthKind(inspectedConnection, view?.errors[inspectedConnection.id]);
      if (kind === 'unreachable') void runCheckOne(inspectedConnection.id);
      else void startSignIn(inspectedConnection, 'browser');
      return;
    }
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
  const projectLabel = project?.name ? `${project.name}'s` : "this project's";

  return <ChipPopover ref={dialog} aria-label={title} trigger={visibleChip} anchor={anchor} width={400}
    instant={instant} panelClassName="ex-panel" className="ex-dialog" onKeyDown={onKeyDown} onPaste={onPaste}
    // While the add runs, neither Escape nor a click outside closes the popover, so a stray press keeps the add's
    // outcome in view. The form's Close leaves on purpose; an add that ends after the popover closed switches nothing.
    onClose={pending === 'add' ? () => {} : onClose}
    // Escape leaves the add form first; with no connections the form is the whole popover.
    onEscape={pending === 'add' ? () => {} : !showSettings && adding !== null && hasRows ? () => setAdding(null) : undefined}>
    <header className="ex-header">
      <span className="ex-header-title">
        <span className="ex-header-mark" aria-hidden="true"><ExecutorMark /></span>
        <h2>{title}</h2>
      </span>
      <div className="ex-header-actions">
        {!showSettings && anySignedIn && <button type="button" className="ex-button" aria-disabled={anyChecking || undefined}
          onClick={() => void runCheckAll()}>
          <ShimmerText text={anyChecking ? 'Checking…' : 'Check all'} active={anyChecking} />
        </button>}
        <button type="button" className="ex-button" aria-disabled={busy !== null || undefined} onClick={event => {
          if (busy) return;
          event.currentTarget.focus();
          setShowSettings(!showSettings);
        }}>{showSettings ? 'Back to connections' : 'Executor settings'}</button>
      </div>
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
        : <section ref={rowsBox} className="ex-rows" aria-label="Connections"
          onMouseMove={() => rowsBox.current?.removeAttribute('data-keys')}>
          {rows.map(row => <div key={row.id} className={row.dividerBefore ? 'ex-row-group-break' : undefined}>
            <button type="button" className="ex-row" data-row={row.id}
              data-inspected={row.id === activeInspectId ? '' : undefined}
              aria-pressed={row.id === current} aria-busy={row.id === busy || undefined}
              aria-disabled={busy !== null && row.id !== busy ? true : undefined}
              onFocus={() => setInspectedRow(row.id)}
              onMouseEnter={() => {
                clearTimeout(hoverTimer.current);
                if (row.connection || row.id === 'default' || row.id === 'off') {
                  hoverTimer.current = setTimeout(() => setInspectedRow(row.id), HOVER_REST_MS);
                }
              }}
              onMouseLeave={() => clearTimeout(hoverTimer.current)}
              onClick={() => void pick(row)}>
              {row.keycap ? <kbd>{row.keycap}</kbd> : <span aria-hidden />}
              <span className="ex-row-main">
                {row.dotState && <span className="ex-dot" data-state={row.dotState} aria-hidden="true" />}
                <span className="ex-row-label">{row.label}</span>
                {row.connection?.approvalMode === 'browser' && <span className="ex-mode-tag">browser</span>}
              </span>
              <span className="ex-row-aside" data-warn={row.asideWarn ? '' : undefined}
                data-error={row.asideError ? '' : undefined}>
                {row.id === busy ? 'saving…'
                  : row.shimmerAside && typeof row.aside === 'string'
                    ? <ShimmerText text={row.aside} active />
                    : row.aside}
                {row.id === current && <span className="ex-check" aria-hidden> ✓</span>}
              </span>
            </button>
          </div>)}
          {!showAdd && <button type="button" className="ex-row ex-row-add" data-row="add" aria-disabled={busy !== null || undefined}
            onClick={() => { if (!busy) openAdd(); }}>
            <kbd>a</kbd>
            <span className="ex-row-main"><span className="ex-row-label">Add connection…</span></span>
            <span className="ex-row-aside">or paste a URL</span>
          </button>}
        </section>}
      {addedName && pending && !rows.some(row => row.id === pending) &&
        <p className="ex-empty" role="status">Switching to {addedName} and starting its sign-in…</p>}
      {view && showAdd && <AddForm key={adding ?? ''} initialUrl={adding ?? ''} count={view.connections.length}
        onBusy={next => setPending(next ? 'add' : null)} onAdded={added} onClose={onClose} onLost={text => reportUnsaved(threadId, text)} />}
      {signIns.map(signIn => <SignInPanel key={signIn.id} signIn={signIn}
        name={view?.connections.find(c => c.id === signIn.id)?.name ?? signIn.id} />)}
      {view && hasRows && !showAdd && <InspectorTray
        rowId={activeInspectId}
        connection={inspectedConnection}
        inheritedOff={activeInspectId === 'default' && inherited.kind === 'off'}
        error={inspectedConnection ? view.errors[inspectedConnection.id] : undefined}
        busy={actionBusy !== null || busy !== null}
        now={now}
        onSignIn={startSignIn}
        onCheck={runCheckOne}
      />}
      {unsaved && <p className="ex-error" role="alert">{unsaved}</p>}
      {error && <p className="ex-error" role="alert">{error}</p>}
      <footer className="ex-footer">
        {projectTarget && !showAdd && pending !== 'add' && <button type="button" className="ex-project-action"
          aria-disabled={actionBusy !== null || busy !== null || undefined}
          aria-busy={actionBusy === 'project' || undefined}
          title={isAlreadyProjectDefault ? `Reset ${projectLabel} default to inherit global default` : `Set ${projectTarget.label} as ${projectLabel} default`}
          onClick={() => void toggleProjectDefault()}>
          <kbd>p</kbd>
          <span className="ex-project-action-text">
            {actionBusy === 'project'
              ? `Saving ${projectLabel} default…`
              : isAlreadyProjectDefault
                ? `${projectTarget.label} is ${projectLabel} default ✓`
                : `Make ${projectTarget.label} ${projectLabel} default`}
          </span>
          {isAlreadyProjectDefault && actionBusy !== 'project' && <span className="ex-project-reset">Reset</span>}
        </button>}
        {hasRows && pending !== 'add' && <span className="ex-keys">
          <kbd>↑</kbd><kbd>↓</kbd> inspect <kbd>↵</kbd> pick
          {inspectedConnection && <><kbd>r</kbd> {healthKind(inspectedConnection, view?.errors[inspectedConnection.id]) === 'unreachable' ? 'retry' : 'sign in'}</>}
          <kbd>esc</kbd> close
        </span>}
        <span>{threadId ? "Applies to this thread's next Executor call." : 'Applies before the agent starts. Off disables Executor tools.'}</span>
      </footer>
    </>}
  </ChipPopover>;
}

function InspectorTray({ rowId, connection, inheritedOff, error, busy, now, onSignIn, onCheck }: {
  rowId: string;
  connection: ConnectionView | null;
  inheritedOff: boolean;
  error: string | undefined;
  busy: boolean;
  now: number;
  onSignIn: (connection: ConnectionView, method: 'browser' | 'device') => Promise<void>;
  onCheck: (id: string) => Promise<void>;
}) {
  const { outerRef, innerRef } = useMorphHeight(0.26);

  return <section ref={outerRef} className="ex-inspector" aria-label={connection ? `${connection.name} details` : 'Connection details'}>
    <div ref={innerRef} className="ex-inspector-inner">
      {(rowId === 'off' || inheritedOff) ? <>
        <div className="ex-insp-head">
          <span className="ex-insp-host">Executor tools disabled</span>
        </div>
        <p className="ex-insp-copy">No Executor tools will be exposed to this thread.</p>
      </> : !connection ? (
        <p className="ex-insp-copy">Select a connection to inspect its status and apps.</p>
      ) : (
        <ConnectionInspector connection={connection} error={error} busy={busy} now={now} onSignIn={onSignIn} onCheck={onCheck} />
      )}
    </div>
  </section>;
}

function ConnectionInspector({ connection, error, busy, now, onSignIn, onCheck }: {
  connection: ConnectionView;
  error: string | undefined;
  busy: boolean;
  now: number;
  onSignIn: (connection: ConnectionView, method: 'browser' | 'device') => Promise<void>;
  onCheck: (id: string) => Promise<void>;
}) {
  const kind = healthKind(connection, error);
  const dotState = dotStateFor(kind);
  const health = connection.health;
  const host = connection.host || connection.url;
  const modeLabel = connection.approvalMode === 'browser' ? 'browser' : 'model';
  const toolText = health?.toolCount !== null && health?.toolCount !== undefined
    ? `${health.toolCount.toLocaleString()} tool${health.toolCount === 1 ? '' : 's'}`
    : null;

  const statusText = kind === 'ok' ? (toolText ? `Live · ${toolText}` : 'Live')
    : kind === 'degraded' ? (toolText ? `App issue · ${toolText}` : 'App issue')
    : kind === 'reauth' ? 'Sign-in rejected'
    : kind === 'unreachable' ? 'Offline'
    : kind === 'checking' ? 'Checking…'
    : kind === 'signing-in' ? 'Waiting for approval'
    : kind === 'signed-out' ? 'Signed out'
    : kind === 'error' ? 'Error'
    : 'Signed in';

  const reason = health?.message ?? error ?? null;
  const apps = health?.apps ?? [];
  const brokenApps = apps.filter(a => !a.ok);
  const visibleApps = apps.slice(0, MAX_VISIBLE_APPS);
  const hiddenCount = Math.max(0, apps.length - visibleApps.length);
  const showAccountInline = apps.length <= 2;

  return <>
    <div className="ex-insp-head">
      <span className="ex-insp-host" title={connection.url}>
        {host}<span className="ex-sep" aria-hidden="true">·</span>{modeLabel}
      </span>
      <span className="ex-insp-status" data-state={dotState}>
        <span className="ex-dot" data-state={dotState} aria-hidden="true" />
        <ShimmerText text={statusText} active={kind === 'checking' || kind === 'signing-in'} />
      </span>
    </div>

    {(kind === 'reauth' || kind === 'signed-out') && <div className="ex-insp-callout" data-tone={kind === 'reauth' ? 'danger' : 'warn'}>
      <div className="ex-insp-callout-copy">
        <strong>{kind === 'reauth' ? 'Sign-in needs renewal' : `${connection.name} is signed out`}</strong>
        <span>{reason ?? 'Sign in once in your browser so threads can use this connection.'}</span>
      </div>
      <div className="ex-insp-callout-actions">
        <button type="button" className="ex-button ex-button-primary" aria-disabled={busy || undefined}
          onClick={() => void onSignIn(connection, 'browser')}>Sign in</button>
        <button type="button" className="ex-button" aria-disabled={busy || undefined}
          onClick={() => void onSignIn(connection, 'device')}>Code</button>
      </div>
    </div>}

    {kind === 'unreachable' && <div className="ex-insp-callout" data-tone="danger">
      <div className="ex-insp-callout-copy">
        <strong>Could not reach {host}</strong>
        <span>{reason ? `${reason} · Saved sign-in kept.` : 'Saved sign-in kept. Check network or VPN.'}</span>
      </div>
      <div className="ex-insp-callout-actions">
        <button type="button" className="ex-button" aria-disabled={busy || undefined}
          onClick={() => void onCheck(connection.id)}>Retry</button>
      </div>
    </div>}

    {kind === 'error' && reason && <div className="ex-insp-callout" data-tone="danger">
      <div className="ex-insp-callout-copy">
        <strong>Last request failed</strong>
        <span>{reason}</span>
      </div>
      <div className="ex-insp-callout-actions">
        <button type="button" className="ex-button" aria-disabled={busy || undefined}
          onClick={() => void onCheck(connection.id)}>Check</button>
        <button type="button" className="ex-button" aria-disabled={busy || undefined}
          onClick={() => void onSignIn(connection, 'browser')}>Reconnect</button>
      </div>
    </div>}

    {(kind === 'ok' || kind === 'degraded' || kind === 'unknown' || kind === 'checking') && <>
      {apps.length > 0
        ? <p className="ex-app-list">
          {visibleApps.map((app, idx) => <Fragment key={`${app.app}:${app.account ?? ''}`}>
            {idx > 0 && <span className="ex-sep" aria-hidden="true">·</span>}
            <span className="ex-app-item" data-ok={app.ok ? 'true' : 'false'}
              title={app.reason ?? (app.account ? `${app.app} — ${app.account}` : app.app)}>
              {!app.ok && <span className="ex-dot ex-app-dot" data-state="warn" aria-hidden="true" />}
              <span className="ex-app-name">{app.app}</span>
              {showAccountInline && app.account && <span className="ex-app-account"> ({app.account})</span>}
            </span>
          </Fragment>)}
          {hiddenCount > 0 && <span className="ex-app-more"> +{hiddenCount} more</span>}
        </p>
        : <p className="ex-insp-copy">
          {kind === 'checking'
            ? <ShimmerText text="Checking sign-in and apps…" active />
            : kind === 'ok' ? 'Connected and verified.'
            : 'Click Check all to verify sign-in and list apps.'}
        </p>}

      {kind === 'degraded' && <div className="ex-insp-callout" data-tone="warn">
        <div className="ex-insp-callout-copy">
          <strong>{brokenApps.map(a => a.app).join(', ') || 'App'} unavailable</strong>
          <span>{brokenApps[0]?.reason ?? 'Open Executor to reconnect the affected app.'}</span>
        </div>
        <div className="ex-insp-callout-actions">
          <UrlLink className="ex-button ex-button-warn" href={connection.webUrl}>Open Executor</UrlLink>
        </div>
      </div>}

      <div className="ex-insp-meta">
        <span className="ex-muted ex-tabular">
          {health?.checkedAt ? `Checked ${timeAgo(health.checkedAt, now)}` : 'Not checked yet'}
        </span>
        <span className="ex-insp-links">
          <button type="button" className="ex-inline-link" aria-disabled={busy || kind === 'checking' || undefined}
            onClick={() => void onCheck(connection.id)}>Check</button>
          <button type="button" className="ex-inline-link" aria-disabled={busy || undefined}
            onClick={() => void onSignIn(connection, 'browser')}>Reconnect</button>
          <UrlLink className="ex-inline-link" href={connection.webUrl}>Executor ↗</UrlLink>
        </span>
      </div>
    </>}
  </>;
}
