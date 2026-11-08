import type { LabState } from './lab-model';
export function LabView({ state, pending, error, onPrepare, onRun, onReconcile, onRefresh }: {
  state: LabState | null; pending: boolean; error: string | null;
  onPrepare: () => void; onRun: (id: string, revision: number) => void;
  onReconcile: (id: string, revision: number) => void; onRefresh: () => void;
}) {
  const lab = state?.kind === 'available' ? state.lab : null;
  const blocked = pending || error !== null;
  const active = lab?.phase === 'preparing' || lab?.phase === 'rehearsing';
  const finished = lab?.phase === 'checks-pending';
  const unavailable = error !== null || state?.kind === 'unavailable';
  const title = unavailable ? 'Cannot check the test right now' : !state ? 'Checking the last test…'
    : lab?.phase === 'ready' ? 'Ready to test'
    : lab?.phase === 'preparing' ? 'Preparing a test copy…'
    : lab?.phase === 'rehearsing' ? 'Testing a separate copy of BB…'
    : finished ? 'The test copy started successfully'
    : lab?.phase === 'interrupted' ? 'The test was interrupted'
    : lab?.phase === 'stopped' ? 'The test copy has stopped'
    : lab?.phase === 'blocked' ? 'The test could not finish'
    : 'Test the fixes without changing your BB';
  const description = unavailable ? 'Check your connection, then select Refresh.'
    : finished ? 'Your current BB has not changed. You do not need to restart anything.'
    : active ? 'Your BB stays running. You can close this window and check back later.'
    : lab?.phase === 'ready' ? 'The fixes are prepared in a separate copy of BB. Run the test when you are ready.'
    : lab?.phase === 'interrupted' ? 'Stop the test copy before trying again. Your current BB will stay running.'
    : lab?.phase === 'stopped' ? 'Your BB has not changed. You can start a new test.'
    : lab?.phase === 'blocked' ? 'Your BB has not changed. Check the test details before trying again.'
    : 'We will prepare a separate copy of BB to test the fixes. Your BB will stay running.';
  function prepareButton() {
    return <button type="button" disabled={blocked || !state} onClick={onPrepare}>{lab ? 'Test again' : 'Prepare test copy'}</button>;
  }
  return <section className="ph-next" aria-label="Test the fixes" aria-busy={pending || active}>
    <h3 role={active ? 'status' : undefined}>{title}</h3>
    <p role={unavailable ? 'alert' : undefined}>{description}</p>
    {finished && <p>Installing the fixes in your BB is the next step. That is not available here yet.</p>}
    {!finished && <div className="ph-next-actions">
      {unavailable ? <button type="button" disabled={pending} onClick={onRefresh}>Refresh</button>
        : lab?.phase === 'ready' ? <button type="button" disabled={blocked} onClick={() => onRun(lab.id, lab.revision)}>Run test</button>
          : lab?.phase === 'interrupted' ? <button type="button" disabled={blocked} onClick={() => onReconcile(lab.id, lab.revision)}>Stop test copy</button>
            : !active && prepareButton()}
    </div>}
    {(lab || unavailable) && <details><summary>Test details</summary>
      {(error || state?.kind === 'unavailable') && <p>{error ?? (state?.kind === 'unavailable' ? state.reason : '')}</p>}
      {lab && <>
        <dl>
          <dt>Patch checks</dt><dd>{lab.checks.offline === 'passed' ? 'Passed' : 'Not finished'}</dd>
          <dt>Starting the test copy</dt><dd>{lab.checks.restart === 'passed' ? 'Passed' : 'Not finished'}</dd>
          {lab.checks.activityAggregation && <><dt>Workflow count</dt><dd>{lab.checks.activityAggregation === 'passed' ? 'Passed with test data' : 'Not finished'}</dd></>}
          <dt>Features in your current BB</dt><dd>Not checked</dd>
        </dl>
        <p>These checks do not confirm every feature works. Model settings still need a test with an actual agent.</p>
        <ol>{lab.events.map((event, index) => <li key={`${index}-${event}`}>{event}</li>)}</ol>
        <p>Test ID: <code>{lab.id}</code></p><p>Test files: <code>{lab.root}</code></p>
      </>}
      <div className="ph-next-actions">
        {finished && prepareButton()}
        <button type="button" disabled={pending} onClick={onRefresh}>Refresh</button>
      </div>
    </details>}
  </section>;
}
