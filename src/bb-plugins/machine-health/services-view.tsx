import { useState } from 'react';
import type { AppProcess } from './src/triage.ts';
import type { Service } from './src/services.ts';
import { humanMb } from './src/format.ts';

export type EndProcess = (pid: number, command: string, started: string) => Promise<void>;

export function ProcessRows({ processes, busy, onEnd }: { processes: AppProcess[]; busy: boolean; onEnd: EndProcess }) {
  return <ul className="mh-procs">
    {processes.map(proc => <li key={`${proc.pid}-${proc.started}`}>
      <span className="mh-mb">≈{humanMb(proc.mb)}</span>
      <code title={proc.command}>{proc.pid} {proc.command}</code>
      {proc.owner !== null ? <span className="mh-why">{proc.owner === 'thread' ? 'BB thread' : 'BB infrastructure'}</span>
        : <details className="mh-stop">
          <summary aria-label={`Stop process ${proc.pid}`} aria-disabled={busy || !proc.started}
            onClick={event => { if (busy || !proc.started) event.preventDefault(); }}>Stop…</summary>
          <div className="mh-confirm">
            <span>Stop PID {proc.pid}?</span>
            <button type="button" disabled={busy || !proc.started} onClick={event => {
              const detail = event.currentTarget.closest('details');
              if (detail) { detail.open = false; detail.querySelector('summary')?.focus(); }
              if (proc.started) void onEnd(proc.pid, proc.command, proc.started);
            }}>Stop process</button>
            <button type="button" onClick={event => {
              const detail = event.currentTarget.closest('details');
              if (detail) { detail.open = false; detail.querySelector('summary')?.focus(); }
            }}>Cancel</button>
          </div>
        </details>}
    </li>)}
  </ul>;
}

function age(seconds: number | null): string {
  if (seconds === null) return 'Age unknown';
  if (seconds < 60) return 'Under a minute';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m old`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h old`;
  return `${Math.floor(seconds / 86400)}d old`;
}

export function Services({ services, error, busy, onEnd }: { services: Service[]; error: string | null; busy: boolean; onEnd: EndProcess }) {
  const [all, setAll] = useState(false);
  return <section aria-label="Development services">
    <p className="mh-view-note">Recognised servers and browser workers. Age alone does not mean abandoned.</p>
    {error && <p role="status" className="mh-error">{error}</p>}
    {services.length === 0 && <p className="mh-empty">No recognised development services found. Check Apps for other processes.</p>}
    <ul className="mh-list mh-services">
      {(all ? services : services.slice(0, 5)).map(service => <li key={service.rootPid}>
        <details className="mh-service">
          <summary>
            <span className="mh-service-name"><strong>{service.cwd?.split('/').filter(Boolean).slice(-2).join(' / ') ?? service.name}</strong>
              <span>{service.name} · {age(service.ageSec)} · {service.processes.length} {service.processes.length === 1 ? 'process' : 'processes'}</span></span>
            <span className="mh-mb">≈{humanMb(service.mb)}</span>
          </summary>
          <div className="mh-service-detail">
            <p>{service.evidence}</p>
            <dl className="mh-rows">
              <div><dt>Directory</dt><dd>{service.cwd ?? 'Unavailable'}</dd></div>
              <div><dt>Listeners</dt><dd>{service.listeners.join(', ') || 'None reported'}</dd></div>
            </dl>
            <p className="mh-view-note">Check the owning work before stopping a process. Workers may remain after their server exits.</p>
            <ProcessRows processes={service.processes} busy={busy} onEnd={onEnd} />
          </div>
        </details>
      </li>)}
    </ul>
    {services.length > 5 && <button type="button" className="mh-link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${services.length} services`}</button>}
    {services.length === 50 && <p className="mh-view-note">Showing the first 50 services by footprint.</p>}
  </section>;
}
