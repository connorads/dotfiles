import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import { useBbNavigate, useRpc } from '@get-bb/plugin-sdk/app';
import type { Outcome, ThreadRowData, TriageData, rpcContract } from './contracts.ts';
import { gapText, humanMb } from './src/format.ts';
import { segmentLines, slotLines, stateGlyph, type Gauge, type Lines } from './src/gauge.ts';
import { detailRows, type Machine } from './src/present.ts';
import { ProcessRows, Services, type EndProcess } from './services-view.tsx';
import type { AppGroup } from './src/triage.ts';

export type Anchor = { right: number; bottom: number } | null;
export const chipEl = (threadId: string) => document.querySelector<HTMLElement>(`[data-machine-health="${CSS.escape(threadId)}"]`);

const topApps = 5;
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function Rows({ machine }: { machine: Machine }) {
  return <dl className="mh-rows">
    {detailRows(machine, Date.now()).map(row => <div key={row.label} data-tone={row.tone}>
      <dt>{row.label}</dt><dd>{row.value}</dd>
    </div>)}
  </dl>;
}

function ArmRow({ label, arm, lines, gloss }: { label: string; arm: Gauge['slots']; lines: Lines; gloss: string }) {
  return <div className="mh-arm" data-state={arm.state}>
    <span className="mh-arm-label">{stateGlyph[arm.state]} {label}</span>
    <span className="mh-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={arm.pct}
      aria-label={`${label} ${arm.pct}%, amber at ${lines.busy}%, red at ${lines.critical}%`}>
      <span className="mh-bar-fill" style={{ width: `${Math.min(arm.pct, 100)}%` }} />
      <span className="mh-tick mh-tick-amber" style={{ left: `${lines.busy}%` }} />
      <span className="mh-tick mh-tick-red" style={{ left: `${lines.critical}%` }} />
    </span>
    <span className="mh-arm-pct">{arm.pct}%</span>
    <span className="mh-arm-gap">{gapText(arm.gap)}</span>
    <span className="mh-arm-size">{arm.usedGib} of {arm.limitGib} GiB</span>
    <span className="mh-gloss">{gloss}</span>
  </div>;
}

function MemoryBars({ gauge, action }: { gauge: Gauge; action: string }) {
  const marker = gauge.pressure === 4 ? ' ▲ critical' : gauge.pressure === 2 ? ' ▲ warn' : '';
  return <section aria-labelledby="mh-memory">
    <h3 id="mh-memory">Memory</h3>
    <div className="mh-state" data-state={gauge.state}>
      <strong>{stateGlyph[gauge.state]} {gauge.state}</strong>
      <span>pressure {gauge.pressure}/4<span className="mh-marker">{marker}</span></span>
      <span>wired {humanMb(gauge.wiredMb)}</span>
    </div>
    <ArmRow label="Slots" arm={gauge.slots} lines={slotLines} gloss="Pages held. Falls only when the owning process frees or exits." />
    <ArmRow label="Segments" arm={gauge.segments} lines={segmentLines}
      gloss={`Storage held. Also falls by swapout. Swap ${humanMb(gauge.swapUsedMb)} of ${humanMb(gauge.swapTotalMb)}.`} />
    <p className="mh-row">Ratio {gauge.ratio.now} pages per segment (limits {gauge.ratio.limits}): {gauge.ratio.fillsFirst} fill first.</p>
    <p className="mh-row mh-action">{action}</p>
  </section>;
}

function Apps({ apps, busy, onEnd }: { apps: AppGroup[]; busy: boolean; onEnd: EndProcess }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const max = apps[0]?.mb ?? 1;
  return <section aria-labelledby="mh-apps">
    <h3 id="mh-apps">Top apps <small>footprint; shared pages over-count</small></h3>
    {apps.length === 0 && <p className="mh-empty">No footprint data.</p>}
    <ul className="mh-list">
      {(all ? apps : apps.slice(0, topApps)).map(app => <li key={app.app}>
        <button type="button" className="mh-app" aria-expanded={open === app.app} onClick={() => setOpen(open === app.app ? null : app.app)}>
          <span className="mh-name">{app.app}</span>
          <span className="mh-mini"><span style={{ width: `${(app.mb / max) * 100}%` }} /></span>
          <span className="mh-mb">≈{humanMb(app.mb)}</span>
          <span className="mh-count">({app.count})</span>
        </button>
        {open === app.app && <ProcessRows processes={app.processes} busy={busy} onEnd={onEnd} />}
      </li>)}
    </ul>
    {apps.length > topApps && <button type="button" className="mh-link" onClick={() => setAll(!all)}>{all ? `Show top ${topApps}` : `Show top ${apps.length} apps`}</button>}
  </section>;
}

function Threads({ threads, busy, hibernating, retry, onHibernate, onOpen }: {
  threads: ThreadRowData[]; busy: boolean; hibernating: boolean; retry: string[] | null;
  onHibernate: (ids: string[]) => Promise<boolean>; onOpen: (id: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // A hibernate that failed, even one started by a dialog since closed, puts its ticks back for a retry.
  useEffect(() => { if (retry) setSelected(new Set(retry)); }, [retry]);
  const [confirming, setConfirming] = useState(false);
  const action = useRef<HTMLButtonElement>(null);
  const no = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const id = useId();
  // The question takes focus on its safe answer, so a second Enter cannot hibernate.
  useEffect(() => {
    if (confirming) no.current?.focus();
    else if (refocus.current) { refocus.current = false; action.current?.focus(); }
  }, [confirming]);
  const ids = [...selected].filter(id => threads.some(row => row.threadId === id && row.refusal === null));
  const flip = (id: string) => setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  // Ticks stay through a failed call, so a retry is one click.
  const run = async () => { setConfirming(false); if (await onHibernate(ids)) setSelected(new Set()); };
  const cancel = () => { refocus.current = true; setConfirming(false); };
  return <section aria-labelledby="mh-threads">
    <h3 id="mh-threads">bb threads on this machine <small>provider process tree footprint</small></h3>
    {threads.length === 0 && <p className="mh-empty">No Claude provider processes run here.</p>}
    <ul className="mh-list">
      {threads.map((row, index) => <li key={row.threadId} className="mh-thread" data-safe={row.refusal === null}>
        <input type="checkbox" aria-label={`Select ${row.title}`} aria-describedby={`${id}-why-${index}`} disabled={row.refusal !== null || busy}
          checked={selected.has(row.threadId)} onChange={() => flip(row.threadId)} />
        <button type="button" className="mh-link mh-name" title={`Open thread: ${row.title}`} onClick={() => onOpen(row.threadId)}>{row.title}</button>
        <span className="mh-mb">{humanMb(row.mb)}</span>
        <span className="mh-why" id={`${id}-why-${index}`} title={row.refusal ?? 'idle'}>{row.refusal ?? 'idle'}</span>
      </li>)}
    </ul>
    <div className="mh-actions">
      {confirming
        ? <span className="mh-confirm" role="group" aria-labelledby={`${id}-ask`}><span id={`${id}-ask`}>Hibernate {threadCount(ids.length)}?</span>
          <button type="button" disabled={busy || ids.length === 0} onClick={() => { void run(); }}>Yes</button>
          <button type="button" ref={no} data-mh-cancel onClick={cancel}>No</button></span>
        : <button type="button" ref={action} disabled={ids.length === 0 || busy}
          onClick={() => { if (ids.length > 1) setConfirming(true); else void run(); }}>
          {hibernating ? 'Hibernating…' : `Hibernate selected${ids.length ? ` (${ids.length})` : ''}`}
        </button>}
      <small>Stops the runtime; the next message resumes the session.</small>
    </div>
  </section>;
}

type Hibernated = { summary: string; outcomes: Outcome[]; titles: Map<string, string> };

/**
 * A thread's Stop or Hibernate and its outcome, kept outside the dialog: closing
 * mid-call must not re-arm the action or lose its result. The entry goes when a
 * dialog that has shown the outcome closes.
 */
type Work = {
  running: 'hibernate' | 'stop' | null; hostId: string | null;
  hibernated: Hibernated | null; status: string | null; error: string | null; retry: string[] | null;
};
const idle: Work = { running: null, hostId: null, hibernated: null, status: null, error: null, retry: null };
const work = new Map<string, Work>();
const workListeners = new Set<() => void>();
const subscribeWork = (listener: () => void) => { workListeners.add(listener); return () => { workListeners.delete(listener); }; };
function setWork(threadId: string, next: Partial<Work>) {
  work.set(threadId, { ...(work.get(threadId) ?? idle), ...next });
  workListeners.forEach(listener => listener());
}
/** Stop and Hibernate act on the machine, so a dialog for another thread on it waits too. */
const runningElsewhere = (hostId: string | undefined, threadId: string) =>
  hostId !== undefined && [...work].some(([id, entry]) => id !== threadId && entry.running !== null && entry.hostId === hostId);
const threadCount = (count: number) => `${count} ${count === 1 ? 'thread' : 'threads'}`;

/** The summary line, then one line per thread that was not hibernated, by title. */
function HibernateResult({ summary, outcomes, titles }: Hibernated) {
  const title = (id: string) => titles.get(id) ?? id;
  const notes = outcomes.flatMap(outcome => 'reason' in outcome ? [`${title(outcome.threadId)}: ${outcome.outcome}, ${outcome.reason}`]
    : outcome.outcome === 'still-running' ? [`${title(outcome.threadId)}: stopped, but its process had not exited after 6 s`] : []);
  return <div role="status" className="mh-result">
    <p>{summary}</p>
    {notes.length > 0 && <ul>{notes.map(note => <li key={note}>{note}</li>)}</ul>}
  </div>;
}

export function MachineDialog({ threadId, anchor, machine, machineError, onRefreshMachine, labelButton, onClose }: {
  threadId: string; anchor: Anchor; machine: Machine | null; machineError: string | null;
  onRefreshMachine: () => void; labelButton: React.ReactNode; onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [data, setData] = useState<TriageData | null>(null);
  const [triageError, setTriageError] = useState<string | null>(null);
  const { running, hibernated, status, error, retry } = useSyncExternalStore(subscribeWork, () => work.get(threadId) ?? idle);
  const elsewhere = useSyncExternalStore(subscribeWork, () => runningElsewhere(data?.hostId, threadId));
  const hibernating = running === 'hibernate';
  const busy = running !== null || elsewhere;
  const [loading, setLoading] = useState(false);
  // Reopened during or after a hibernate, the dialog starts where its ticks and button are.
  const [view, setView] = useState<'services' | 'threads' | 'apps'>(() =>
    work.get(threadId)?.running === 'hibernate' || work.get(threadId)?.retry ? 'threads' : 'services');
  const request = useRef(0);
  const box = useRef<HTMLDialogElement>(null);
  const viewBox = useRef<HTMLDivElement>(null);
  const outcome = useRef<HTMLDivElement>(null);
  /** Set when an action starts; holds until its outcome is shown and focus has a home. */
  const rescue = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (!work.get(threadId)?.running) work.delete(threadId); };
  }, [threadId]);

  const refreshTriage = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    try {
      const next = await rpc.call('triage', { threadId });
      if (current === request.current) { setData(next); setTriageError(null); }
    } catch (cause) { if (current === request.current) setTriageError(message(cause)); }
    finally { if (current === request.current) setLoading(false); }
  }, [rpc, threadId]);
  const refresh = useCallback(() => { onRefreshMachine(); void refreshTriage(); }, [onRefreshMachine, refreshTriage]);

  useEffect(() => { setData(null); void refreshTriage(); return () => { request.current++; }; }, [refreshTriage]);
  // An action started by an earlier, closed dialog refreshes this one when it ends.
  const inherited = useRef(running !== null);
  useEffect(() => { if (inherited.current && !running) { inherited.current = false; refresh(); } }, [running, refresh]);
  // So does one started from another thread's dialog on this machine.
  const waited = useRef(false);
  useEffect(() => { if (elsewhere) waited.current = true; else if (waited.current) { waited.current = false; refresh(); } }, [elsewhere, refresh]);

  const shown = hibernated ?? status ?? error;
  // A new outcome scrolls into view, so a short screen shows it below the lists, also once they load.
  const listed = data !== null;
  useEffect(() => { if (shown && listed) outcome.current?.scrollIntoView({ block: 'nearest' }); }, [shown, listed]);
  // An action unmounts or disables the control that started it (Yes, Hibernate, a stopped row).
  // Focus then moves to the views while the call runs, and to its outcome once shown,
  // so `r`, `q` and Tab keep working from where the user was. ChipPopover parks lost focus on the dialog itself.
  useEffect(() => {
    if (!rescue.current) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || active === box.current || active === viewBox.current || active.matches(':disabled');
    if (lost && outcome.current) outcome.current.focus();
    else if (lost) viewBox.current?.focus({ preventScroll: true });
    if (!busy && !loading && (!lost || outcome.current)) rescue.current = false;
  });

  const hibernate = async (threadIds: string[]) => {
    if (!data || busy) return false;
    rescue.current = true;
    setWork(threadId, { ...idle, running: 'hibernate', hostId: data.hostId, status: `Hibernating ${threadCount(threadIds.length)}…` });
    // Titles from this sample: the refresh after the stops may drop hibernated threads from the list.
    const titles = new Map(data.threads.map(row => [row.threadId, row.title]));
    try { setWork(threadId, { running: null, status: null, hibernated: { ...await rpc.call('hibernate', { hostId: data.hostId, threadIds }), titles } }); return true; }
    catch (cause) { setWork(threadId, { running: null, status: null, error: `Hibernate failed: ${message(cause)}`, retry: threadIds }); return false; }
    finally { if (alive.current) refresh(); }
  };
  const end = async (pid: number, command: string, started: string) => {
    if (!data || busy) return;
    rescue.current = true;
    setWork(threadId, { ...idle, running: 'stop', hostId: data.hostId, status: `Stopping PID ${pid}…` });
    try {
      const outcome = await rpc.call('terminate', { hostId: data.hostId, pid, command, started });
      setWork(threadId, { running: null, status: outcome.ok ? outcome.outcome === 'exited' ? `Process ${pid} exited.` : `Sent SIGTERM to ${pid}; exit was not confirmed.` : outcome.reason });
    } catch (cause) { setWork(threadId, { running: null, status: null, error: `Could not stop PID ${pid}: ${message(cause)}` }); }
    finally { if (alive.current) refresh(); }
  };

  function keyboard(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    // A checkbox takes no letters, so the shortcuts work right after a tick.
    if (event.target instanceof HTMLElement && event.target.closest('input:not([type="checkbox"]), textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (event.key === 'q' || event.key === 'Q') { event.preventDefault(); onClose(); }
    else if (event.key === 'r' || event.key === 'R') { event.preventDefault(); if (!loading && !busy) refresh(); }
  }
  /** Escape backs out of a visible Stop or Hibernate confirmation before it closes the dialog. */
  function escape() {
    const cancel = Array.from(box.current?.querySelectorAll<HTMLButtonElement>('[data-mh-cancel]') ?? []).find(button => button.checkVisibility());
    if (cancel) cancel.click(); else onClose();
  }

  return <ChipPopover ref={box} panelClassName="mh-panel" aria-label="Machine health" onKeyDown={keyboard}
    trigger={() => chipEl(threadId)} anchor={anchor} width={600} onClose={onClose} onEscape={escape}>
    <header className="mh-heading">
      <strong>{machine?.vitals?.hostname ?? machine?.name ?? 'Machine health'}</strong>
      {data && <span className="mh-health" data-state={data.gauge.state}>{stateGlyph[data.gauge.state]} Memory {data.gauge.state.toLowerCase()}</span>}
    </header>
    {machineError && <p role="alert" className="mh-error">{machineError}</p>}
    {machine && <dl className="mh-summary">
      <div><dt>Swap used</dt><dd>{data ? humanMb(data.gauge.swapUsedMb) : triageError ? 'Unavailable' : '…'}</dd></div>
      <div><dt>CPU</dt><dd>{machine.vitals?.cpuPct == null ? 'Unavailable' : `${Math.round(machine.vitals.cpuPct)}%`}</dd></div>
      <div><dt>Disk free</dt><dd>{machine.vitals?.disk ? humanMb(machine.vitals.disk.freeBytes / 1048576) : 'Unavailable'}</dd></div>
    </dl>}
    {!data && !triageError && <p className="mh-empty" role="status">Reading processes…</p>}
    {triageError && <p role="alert" className="mh-error">{data ? 'Refresh failed. Showing the previous process sample. ' : ''}{triageError}</p>}
    <details className="mh-diagnostics">
      <summary>Memory details and machine vitals</summary>
      {data && <MemoryBars gauge={data.gauge} action={data.action} />}
      {machine && <Rows machine={machine} />}
    </details>
    {data && <>
      <nav className="mh-views" aria-label="Process view">
        <button type="button" aria-pressed={view === 'services'} onClick={() => setView('services')}>Services <span>{data.services.length}</span></button>
        <button type="button" aria-pressed={view === 'threads'} onClick={() => setView('threads')}>Threads <span>{data.threads.length}</span></button>
        <button type="button" aria-pressed={view === 'apps'} onClick={() => setView('apps')}>Apps</button>
      </nav>
      {/* Every view stays mounted, so ticks, expanded rows and confirmations survive a view switch. */}
      {elsewhere && <p role="status" className="mh-empty">A Stop or Hibernate from another thread is running on this machine.</p>}
      <div className="mh-view" ref={viewBox} tabIndex={-1} aria-busy={busy || loading}>
        <div hidden={view !== 'services'}><Services services={data.services} error={data.serviceError} busy={busy || loading} onEnd={end} /></div>
        <div hidden={view !== 'threads'}><Threads threads={data.threads} busy={busy || loading} hibernating={hibernating} retry={retry} onHibernate={hibernate}
          onOpen={id => { onClose(); navigate.toThread(id); }} /></div>
        <div hidden={view !== 'apps'}><Apps apps={data.apps} busy={busy || loading} onEnd={end} /></div>
      </div>
    </>}
    {shown && <div className="mh-outcome" ref={outcome} tabIndex={-1}>
      {hibernated && <HibernateResult {...hibernated} />}
      {status && <p role="status" className="mh-result">{status}</p>}
      {error && <p role="alert" className="mh-error">{error}</p>}
    </div>}
    <footer className="mh-footer">
      {labelButton}
      {/* aria-disabled, not disabled: a disabled button drops keyboard focus, and with it `r` and `q`. */}
      <button type="button" onClick={() => { if (!loading && !busy) refresh(); }} aria-disabled={loading || busy}>{loading ? 'Refreshing…' : 'Refresh (r)'}</button>
      <button type="button" onClick={onClose}>Close</button>
    </footer>
  </ChipPopover>;
}
