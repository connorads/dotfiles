import type { LabState } from './lab-model';
export function LabView({ state, pending, error, onPrepare, onRun, onReconcile, onRefresh }: {
  state: LabState | null; pending: boolean; error: string | null;
  onPrepare: () => void; onRun: (id: string, revision: number) => void;
  onReconcile: (id: string, revision: number) => void; onRefresh: () => void;
}) {
  const lab = state?.kind === 'available' ? state.lab : null;
  const blocked = pending || error !== null;
  const active = lab?.phase === 'preparing' || lab?.phase === 'rehearsing';
  const title = !state ? 'Checking saved rehearsal…' : state.kind === 'unavailable' ? 'Rehearsal unavailable'
    : lab?.phase === 'ready' ? 'Ready for a disposable restart'
    : lab?.phase === 'preparing' ? 'Preparing the copied candidate…'
    : lab?.phase === 'rehearsing' ? 'Rehearsing the server restart…'
    : lab?.phase === 'checks-pending' ? 'Disposable restart passed'
    : lab?.phase === 'interrupted' ? 'Inspect the interrupted rehearsal'
    : lab?.phase === 'stopped' ? 'Lab stopped safely'
    : lab?.phase === 'blocked' ? 'Rehearsal stopped at a check'
    : 'Try the repair process safely';
  return <section className="ph-next" aria-label="Repair rehearsal" aria-busy={pending || active}>
    <span className="ph-next-label">Disposable rehearsal · live activation disabled</span><h3>{title}</h3>
    <p>{lab?.phase === 'checks-pending' ? 'The copied server restarted against separate test data. This does not establish that both features work live.'
      : 'Prepare and restart a copied BB with separate data and ports. Your current BB stays running.'}</p>
    {(error || state?.kind === 'unavailable') && <p role="alert">{error ?? (state?.kind === 'unavailable' ? state.reason : '')}</p>}
    {lab && <dl>
      <dt>Offline feature checks</dt><dd>{lab.checks.offline === 'passed' ? 'Both patches passed' : 'Pending'}</dd>
      <dt>Disposable restart</dt><dd>{lab.checks.restart === 'passed' ? 'Passed' : 'Not completed'}</dd>
      {lab.checks.activityAggregation && <><dt>Activity count API</dt><dd>{lab.checks.activityAggregation === 'passed' ? 'Passed with synthetic records' : 'Not completed'}</dd></>}
      <dt>Live feature acceptance</dt><dd>Not checked</dd>
    </dl>}
    <div className="ph-next-actions">
      {lab?.phase === 'ready' ? <button type="button" disabled={blocked} onClick={() => onRun(lab.id, lab.revision)}>Run rehearsal</button>
        : lab?.phase === 'interrupted' ? <button type="button" disabled={blocked} onClick={() => onReconcile(lab.id, lab.revision)}>Inspect and stop lab</button>
          : active ? <span role="status">{lab.events.at(-1)}</span>
            : <button type="button" disabled={blocked || !state} onClick={onPrepare}>{lab ? 'Prepare fresh rehearsal' : 'Prepare rehearsal'}</button>}
      <button type="button" disabled={pending} onClick={onRefresh}>Refresh rehearsal</button>
    </div>
    {lab && <details><summary>Evidence and saved progress</summary><ol>{lab.events.map((event, index) => <li key={`${index}-${event}`}>{event}</li>)}</ol>
      <p>Operation: <code>{lab.id}</code></p><p>Private lab: <code>{lab.root}</code></p>
      <p>Closing this popover leaves the host worker running. Reopen to resume watching. Candidate data and receipts remain available for inspection.</p>
    </details>}
  </section>;
}
