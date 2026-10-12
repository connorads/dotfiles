import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBbNavigate, useRpc } from '@get-bb/plugin-sdk/app';
import type { Outcome, ThreadRowData, TriageData, rpcContract } from './contracts.ts';
import { gapText, humanMb } from './src/format.ts';
import { segmentLines, slotLines, stateGlyph, type Gauge, type Lines } from './src/gauge.ts';
import { detailRows, type Machine } from './src/present.ts';
import type { AppGroup } from './src/triage.ts';

export type Anchor = { right: number; bottom: number } | null;

const width = 600;
const margin = 12;
const topApps = 5;
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

function place(anchor: Anchor) {
  const w = Math.min(width, window.innerWidth - margin * 2);
  if (!anchor) return { width: w, top: Math.round(window.innerHeight * 0.1), left: (window.innerWidth - w) / 2 };
  return { width: w, top: anchor.bottom + 8, left: Math.min(Math.max(margin, anchor.right - w), window.innerWidth - w - margin) };
}

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

function Apps({ apps, onEnd }: { apps: AppGroup[]; onEnd: (pid: number, command: string) => Promise<void> }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
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
        {open === app.app && <ul className="mh-procs">
          {app.processes.map(proc => <li key={proc.pid}>
            <span className="mh-mb">{humanMb(proc.mb)}</span>
            <code title={proc.command}>{proc.pid} {proc.command}</code>
            {proc.owner === 'thread'
              ? <span className="mh-why">bb thread: hibernate it above</span>
              : proc.owner === 'bb'
              ? <span className="mh-why">part of bb</span>
              : confirm === proc.pid
              ? <span className="mh-confirm">End? <button type="button" onClick={() => { setConfirm(null); void onEnd(proc.pid, proc.command); }}>Yes</button>
                <button type="button" onClick={() => setConfirm(null)}>No</button></span>
              : <button type="button" onClick={() => setConfirm(proc.pid)}>End</button>}
          </li>)}
        </ul>}
      </li>)}
    </ul>
    {apps.length > topApps && <button type="button" className="mh-link" onClick={() => setAll(!all)}>{all ? `Show top ${topApps}` : `Show top ${apps.length} apps`}</button>}
  </section>;
}

function Threads({ threads, busy, onHibernate, onOpen }: {
  threads: ThreadRowData[]; busy: boolean; onHibernate: (ids: string[]) => void; onOpen: (id: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const ids = [...selected].filter(id => threads.some(row => row.threadId === id && row.refusal === null));
  const flip = (id: string) => setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const run = () => { setConfirming(false); setSelected(new Set()); onHibernate(ids); };
  return <section aria-labelledby="mh-threads">
    <h3 id="mh-threads">bb threads on this machine <small>provider process tree footprint</small></h3>
    {threads.length === 0 && <p className="mh-empty">No Claude provider processes run here.</p>}
    <ul className="mh-list">
      {threads.map(row => <li key={row.threadId} className="mh-thread" data-safe={row.refusal === null}>
        <input type="checkbox" aria-label={`Select ${row.title}`} disabled={row.refusal !== null || busy}
          checked={selected.has(row.threadId)} onChange={() => flip(row.threadId)} />
        <button type="button" className="mh-link mh-name" onClick={() => onOpen(row.threadId)}>{row.title}</button>
        <span className="mh-mb">{humanMb(row.mb)}</span>
        <span className="mh-why" title={row.refusal ?? 'idle'}>{row.refusal ?? 'idle'}</span>
      </li>)}
    </ul>
    <div className="mh-actions">
      {confirming
        ? <span className="mh-confirm">Hibernate {ids.length} threads? <button type="button" onClick={run}>Yes</button>
          <button type="button" onClick={() => setConfirming(false)}>No</button></span>
        : <button type="button" disabled={ids.length === 0 || busy}
          onClick={() => ids.length > 1 ? setConfirming(true) : run()}>
          {busy ? 'Hibernating…' : `Hibernate selected${ids.length ? ` (${ids.length})` : ''}`}
        </button>}
      <small>Stops the runtime; the next message resumes the session.</small>
    </div>
  </section>;
}

type Hibernated = { summary: string; outcomes: Outcome[]; titles: Map<string, string> };

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
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<TriageData | null>(null);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [hibernated, setHibernated] = useState<Hibernated | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const position = place(anchor);

  const refreshTriage = useCallback(async () => {
    setLoading(true);
    try { setData(await rpc.call('triage', { threadId })); setTriageError(null); }
    catch (cause) { setTriageError(message(cause)); }
    finally { setLoading(false); }
  }, [rpc, threadId]);
  const refresh = useCallback(() => { onRefreshMachine(); void refreshTriage(); }, [onRefreshMachine, refreshTriage]);

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => { void refreshTriage(); }, [refreshTriage]);

  const hibernate = async (threadIds: string[]) => {
    if (!data) return;
    setBusy(true); setStatus(null); setError(null); setHibernated(null);
    // Titles from this sample: the refresh after the stops may drop hibernated threads from the list.
    const titles = new Map(data.threads.map(row => [row.threadId, row.title]));
    try { setHibernated({ ...await rpc.call('hibernate', { hostId: data.hostId, threadIds }), titles }); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); refresh(); }
  };
  const end = async (pid: number, command: string) => {
    if (!data) return;
    setHibernated(null); setStatus(null); setError(null);
    try {
      const outcome = await rpc.call('terminate', { hostId: data.hostId, pid, command });
      setStatus(outcome.ok ? `Sent SIGTERM to ${pid}.` : outcome.reason);
    } catch (cause) { setError(message(cause)); }
    refresh();
  };

  function keyboard(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Escape') event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement).tagName === 'INPUT') return;
    if ((event.key === 'q' || event.key === 'Q') && !(event.defaultPrevented || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')))) { event.preventDefault(); onClose(); }
    else if (event.key === 'r' || event.key === 'R') { event.preventDefault(); refresh(); }
  }

  return <dialog ref={dialog} className="mh-dialog" aria-label="Machine health" onKeyDown={keyboard}
    style={{ top: position.top, left: position.left, width: position.width }}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onPointerDown={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    <div className="mh-panel">
      <section aria-label="Vitals">
        {machine ? <Rows machine={machine} /> : !machineError && <p className="mh-empty">Sampling…</p>}
        {machineError && <p role="alert" className="mh-error">{machineError}</p>}
      </section>
      {!data && !triageError && <p className="mh-empty">Sampling footprints…</p>}
      {triageError && <p className="mh-empty">{triageError}</p>}
      {data && <>
        <MemoryBars gauge={data.gauge} action={data.action} />
        <Threads threads={data.threads} busy={busy} onHibernate={ids => { void hibernate(ids); }}
          onOpen={id => { onClose(); navigate.toThread(id); }} />
        <Apps apps={data.apps} onEnd={end} />
      </>}
      {hibernated && <HibernateResult {...hibernated} />}
      {status && <p role="status" className="mh-result">{status}</p>}
      {error && <p role="alert" className="mh-error">{error}</p>}
      <footer className="mh-footer">
        {labelButton}
        <button type="button" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh (r)'}</button>
        <button type="button" onClick={onClose}>Close</button>
      </footer>
    </div>
  </dialog>;
}
