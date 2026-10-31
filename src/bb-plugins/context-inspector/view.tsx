import { useState } from 'react';
import { describeObservation, type Target, type ObservationState } from './observation';
import { previewIntroduction } from './patch-preview';
import { fixtures, fixtureOwner, fixtureTarget } from './fixtures';
import './view.css';

export interface ContextInspectorViewProps {
  target: Target;
  state: ObservationState;
  ownerText: string;
  synthetic?: boolean;
  ownerUnavailable?: string;
  savedIntroduction?: boolean;
  onExportPatch?: (patch: string) => void;
}
export function ContextInspectorView(props: ContextInspectorViewProps) {
  // A target change discards the previous target's draft.
  return <InspectorTarget key={JSON.stringify(props.target)} {...props} />;
}
function InspectorTarget({ target, state, ownerText, synthetic = false, ownerUnavailable, savedIntroduction, onExportPatch }: ContextInspectorViewProps) {
  const [tab, setTab] = useState<'recorded' | 'future'>('recorded');
  const [introduction, setIntroduction] = useState(() => {
    const current = previewIntroduction(ownerText, false);
    return current.ok ? current.previous ?? savedIntroduction ?? true : savedIntroduction ?? true;
  });
  const observation = describeObservation(target, state);
  const preview = ownerUnavailable ? { ok: false as const, error: ownerUnavailable } : previewIntroduction(ownerText, introduction);
  return <section className="context-inspector" aria-label="Context inspector">
    {synthetic && <p className="ci-fixture">Synthetic fixture. Values are for rendering tests.</p>}
    <dl><dt>Thread</dt><dd>{target.threadId}</dd><dt>Host</dt><dd>{target.hostId}</dd>
      <dt>Provider session</dt><dd>{target.providerSessionId ?? 'Unknown'}</dd></dl>
    <nav aria-label="Context views">
      <button type="button" aria-pressed={tab === 'recorded'} onClick={() => setTab('recorded')}>Recorded context</button>
      <button type="button" aria-pressed={tab === 'future'} onClick={() => setTab('future')}>Future owner preview</button>
    </nav>
    {tab === 'recorded' ? <div aria-label="Recorded context">
      <p role="status">{observation.message}</p>
      {observation.kind === 'recorded' && observation.usage && <>
        {Number.isFinite(observation.usage.modelContextWindow) && observation.usage.modelContextWindow > 0 && Number.isFinite(observation.usage.usedTokens) && observation.usage.usedTokens >= 0 &&
          <meter aria-label="Recorded token usage" min={0} max={observation.usage.modelContextWindow} value={Math.min(observation.usage.usedTokens, observation.usage.modelContextWindow)} />}
        <p>{observation.usage.usedTokens.toLocaleString('en-GB')} / {observation.usage.modelContextWindow.toLocaleString('en-GB')} tokens. {observation.usage.estimated ? 'Estimated' : 'Reported'} usage.</p>
        {state.kind === 'recorded' && <p>Received {state.observation.receivedAt}</p>}
        {observation.snapshot && <>
          <p>Categories captured {observation.snapshot.capturedAt}. {observation.snapshot.estimated ? 'Estimated' : 'Reported'} categories.</p>
          <p>Snapshot model {observation.snapshot.model}. Snapshot session {observation.snapshot.providerSessionId}.</p>
          <ul>{observation.snapshot.categories.map((category, index) => <li key={`${category.id}-${index}`}>
            {category.label}: {category.tokens.toLocaleString('en-GB')} tokens ({category.kind})
          </li>)}</ul>
        </>}
      </>}
      <p>Category labels do not prove that a specific file, skill or plugin entered this session.</p>
    </div> : <div aria-label="Future owner preview">
      <p>Global desired owner: .config/bb/plugin-config.json</p>
      <p>Only bb-guide.introduction changes. Historical session configuration is unknown.</p>
      <p>Live saved value: {savedIntroduction === undefined ? 'Unknown' : String(savedIntroduction)}. This is current saved state.</p>
      <label><input type="checkbox" disabled={Boolean(ownerUnavailable)} checked={introduction} onChange={event => setIntroduction(event.target.checked)} /> BB Guide introduction</label>
      {!preview.ok ? <p role="alert">{preview.error}</p> : <>
        <p>Existing desired value: {preview.previous === undefined ? 'Unmanaged' : String(preview.previous)}</p>
        {onExportPatch && <button type="button" disabled={!preview.patch} onClick={() => onExportPatch(preview.patch)}>Export private patch</button>}
        <details><summary>Desired-owner JSON</summary><pre>{preview.desiredJson}</pre></details>
        <details><summary>Patch preview</summary><pre>{preview.patch || 'No desired-value change.'}</pre></details>
      </>}
      <p>Preview only. Owner reconciliation is separate. Session activation is unverified. Earlier conversation content remains.</p>
    </div>}
  </section>;
}

/** Plain React driver. No BB hooks, network requests or provider launches. */
export function FixtureContextInspector() {
  const [selected, setSelected] = useState<keyof typeof fixtures>('Count only');
  return <>
    <label> Synthetic scenario <select value={selected} onChange={event => {
      const name = event.target.value;
      const selectedName = Object.keys(fixtures).find(key => key === name);
      if (selectedName === 'Count only' || selectedName === 'Categories' || selectedName === 'Unavailable' || selectedName === 'Late other target') setSelected(selectedName);
    }}>{Object.keys(fixtures).map(name => <option key={name}>{name}</option>)}</select></label>
    <ContextInspectorView target={fixtureTarget} state={fixtures[selected]} ownerText={fixtureOwner} synthetic />
  </>;
}
