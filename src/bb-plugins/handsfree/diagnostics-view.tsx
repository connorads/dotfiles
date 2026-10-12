import { useState, type ReactNode } from 'react';
import type { Diagnostics } from './diagnostics-contract.ts';
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export function HexActivity({ snapshot, now, children }: { snapshot: Diagnostics; now: number; children: ReactNode }) {
  const [unmatched, setUnmatched] = useState(false);
  return <>
    <section aria-label="Hex activity">
    {!snapshot.available ? <p>Hex diagnostics unavailable on this BB server.</p> : <>
      <p className="handsfree-context">{snapshot.state
        ? `Last Hex state: ${snapshot.state.state} at ${time(snapshot.state.at)}` : 'No recent Hex capture state.'}</p>
      {snapshot.transcript && <div className="handsfree-transcript">
        <strong>{now - snapshot.transcript.at < 8000 && snapshot.transcript.phase !== 'completed' ? 'Hearing' : 'Last transcript'}</strong>
        <p>{snapshot.transcript.text || 'Waiting for speech…'}</p>
        <small>{time(snapshot.transcript.at)} · {snapshot.transcript.phase} · {snapshot.transcript.latency} ms</small>
      </div>}
    </>}
    </section>
    {children}
    {snapshot.available && <section aria-label="Hex attempts history">
      <label className="handsfree-filter"><input type="checkbox" checked={unmatched} onChange={event => setUnmatched(event.target.checked)} /> Include unmatched speech</label>
      <ol aria-label="Hex attempts" className="handsfree-history">
        {snapshot.attempts.filter(entry => unmatched || !entry.unmatched).slice().reverse().map((entry, index) => <li key={`${entry.at}:${index}`} data-problem={entry.problem}>
          <div><time>{time(entry.at)}</time><span>Hex {entry.kind}{entry.problem ? ' · Failed' : ''}</span></div>
          <p>{entry.heard || 'No transcript'}</p><strong>{entry.result}</strong>
          <details><summary>Details</summary><dl>
            {entry.command && <><dt>Matched command</dt><dd>{entry.command}</dd></>}
            {entry.context && <><dt>Context</dt><dd>{entry.context}</dd></>}
            <dt>Stage</dt><dd>{entry.kind === 'command' ? 'Hex recognition and handler. BB results appear below.' : 'Hex dictation'}</dd>
          </dl></details>
        </li>)}
      </ol>
    </section>}
  </>;
}
