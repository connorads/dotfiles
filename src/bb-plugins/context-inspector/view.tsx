import { useState, type ReactNode } from 'react';
import { describeObservation, type Target, type ObservationState } from './observation';
import { previewIntroduction } from './patch-preview';
import { fixtures, fixtureOwner, fixtureTarget, fixtureInventory } from './fixtures';
import './view.css';

export interface ContextInspectorViewProps {
  target: Target;
  state: ObservationState;
  ownerText: string;
  synthetic?: boolean;
  ownerUnavailable?: string;
  savedIntroduction?: boolean;
  onExportPatch?: (patch: string) => void;
  inventory?: { rows: { pluginId: string; enabled: boolean; kind: string; id: string; label: string }[]; truncated: boolean } | null;
  inventoryError?: string;
  controls?: ReactNode;
}
export function ContextInspectorView(props: ContextInspectorViewProps) {
  // A target change discards the previous target's draft.
  return <InspectorTarget key={JSON.stringify(props.target)} {...props} />;
}
function InspectorTarget({ target, state, ownerText, synthetic = false, ownerUnavailable, savedIntroduction, onExportPatch, inventory, inventoryError, controls }: ContextInspectorViewProps) {
  const [tab, setTab] = useState<'recorded' | 'sources' | 'future'>('recorded');
  const [introduction, setIntroduction] = useState(() => {
    const current = previewIntroduction(ownerText, false);
    return current.ok ? current.previous ?? savedIntroduction ?? true : savedIntroduction ?? true;
  });
  const observation = describeObservation(target, state);
  const preview = ownerUnavailable ? { ok: false as const, error: ownerUnavailable } : previewIntroduction(ownerText, introduction);
  const usage = observation.kind === 'recorded' ? observation.usage : undefined;
  const capacityKnown = usage && Number.isFinite(usage.modelContextWindow) && usage.modelContextWindow > 0 && Number.isFinite(usage.usedTokens) && usage.usedTokens >= 0;
  const percent = capacityKnown ? Math.min(100, usage.usedTokens / usage.modelContextWindow * 100) : undefined;
  return <section className="context-inspector" aria-label="Context inspector">
    <header className="ci-header">
      <div className="ci-eyebrow"><span className="ci-status-dot" /> Context inspector<span className="ci-spacer" />{controls}</div>
      <div className="ci-headline"><h2>{usage ? usage.usedTokens.toLocaleString('en-GB') : 'Context'}</h2>
        <span>{usage ? 'tokens in this session' : 'Session overview'}</span>
        {percent !== undefined && <span className="ci-pill">{Math.round(percent)}% used</span>}</div>
      {capacityKnown && <meter className="ci-meter" aria-label="Recorded token usage" min={0} max={usage.modelContextWindow} value={Math.min(usage.usedTokens, usage.modelContextWindow)} />}
      <div className="ci-capacity">{usage ? <><span>{usage.usedTokens.toLocaleString('en-GB')} / {usage.modelContextWindow.toLocaleString('en-GB')} tokens</span><span>{usage.estimated ? 'Estimated' : 'Reported'} usage</span></> : <span>No usage report available</span>}</div>
    </header>
    {synthetic && <p className="ci-fixture">Synthetic fixture. Values are for rendering tests.</p>}
    <nav className="ci-tabs" aria-label="Context views">
      <button type="button" aria-pressed={tab === 'recorded'} onClick={() => setTab('recorded')}>Overview</button>
      <button type="button" aria-pressed={tab === 'sources'} onClick={() => setTab('sources')}>Sources{inventory && <span title="Tool and skill registrations">{inventory.rows.length}</span>}</button>
      <button type="button" aria-pressed={tab === 'future'} onClick={() => setTab('future')}>Configure</button>
    </nav>
    <div className="ci-content">
    {tab === 'recorded' ? <div aria-label="Recorded context">
      <div className="ci-section-heading"><h3>Context breakdown</h3><span>Share of context window</span></div>
      {observation.kind === 'recorded' && observation.snapshot ? <>
        <div className="ci-categories">{observation.snapshot.categories.map((category, index) => <div className="ci-category" key={`${category.id}-${index}`}>
          <div><span>{category.label} <small className="ci-category-kind">{category.kind}</small></span><span className="ci-number">{category.tokens.toLocaleString('en-GB')} <small>tokens</small></span></div>
          <div className="ci-category-track" data-kind={category.kind}><i style={{ width: `${capacityKnown ? Math.min(100, Math.max(0, category.tokens / usage.modelContextWindow * 100)) : 0}%` }} /></div>
        </div>)}</div>
        <p className="ci-note" role="status">{observation.message}</p>
      </> : <div className="ci-empty"><span className="ci-empty-mark" aria-hidden="true">≋</span><strong>{usage ? 'Token breakdown unavailable' : 'No recorded context yet'}</strong>
        <p role="status">{observation.message.startsWith('Attribution unavailable') ? 'This report contains a total but no per-source counts.' : observation.message}</p></div>}
      {observation.kind === 'recorded' && observation.snapshot && <p className="ci-note">Category labels do not prove that a specific file, skill or plugin entered this session.</p>}
    </div> : tab === 'sources' ? <SourceInventory inventory={inventory} error={inventoryError} /> : <div aria-label="Future owner preview">
      <div className="ci-section-heading"><h3>Future sessions</h3><span>Patch preview only</span></div>
      <p className="ci-intro">Review a change to your declarative configuration, then export it for Git.</p>
      <div className="ci-setting"><label><span><strong>BB Guide introduction</strong><small>Include BB guidance when a session starts.</small></span>
        <input type="checkbox" disabled={!preview.ok} checked={introduction} onChange={event => setIntroduction(event.target.checked)} /></label>
        <div className="ci-setting-state"><span>Saved <b>{savedIntroduction === undefined ? 'Unknown' : savedIntroduction ? 'On' : 'Off'}</b></span>
          <span>Owner <b>{!preview.ok ? 'Unknown' : preview.previous === undefined ? 'Unmanaged' : preview.previous ? 'On' : 'Off'}</b></span>
          <span className={preview.ok && preview.patch ? 'ci-change-label' : undefined}>Draft <b>{introduction ? 'On' : 'Off'}</b></span></div>
      </div>
      {!preview.ok ? <p className="ci-alert" role="alert">{preview.error}</p> : <>
        <div className="ci-patch-heading"><span>{preview.patch ? '1 setting changed' : 'No desired-value change.'}</span>{onExportPatch && <button className="ci-primary" type="button" disabled={!preview.patch} onClick={() => onExportPatch(preview.patch)}>Export private patch <span aria-hidden="true">↓</span></button>}</div>
        {preview.patch && <pre className="ci-diff" aria-label="Patch preview">{preview.patch.split('\n').map((line, index) => <span key={index} data-kind={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : 'context'}>{line}{'\n'}</span>)}</pre>}
        <details className="ci-disclosure"><summary>Desired-owner JSON</summary><pre>{preview.desiredJson}</pre></details>
      </>}
      <p className="ci-owner-path">.config/bb/plugin-config.json</p>
      <p className="ci-note">Export changes no files. Apply through the owner reconciler after review. Earlier conversation content remains.</p>
      <p className="ci-note">Historical session configuration is unknown. Saved values describe current settings.</p>
    </div>}
    </div>
    <details className="ci-session ci-disclosure"><summary>Session details{state.kind === 'recorded' && <span title={state.observation.receivedAt}>Read {new Date(state.observation.receivedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}</summary>
      <dl><dt>Thread</dt><dd>{target.threadId}</dd><dt>Host</dt><dd>{target.hostId}</dd><dt>Provider session</dt><dd>{target.providerSessionId ?? 'Unknown'}</dd>
        {state.kind === 'recorded' && <><dt>Received</dt><dd>{state.observation.receivedAt}</dd></>}
        {observation.kind === 'recorded' && observation.snapshot && <><dt>Model</dt><dd>{observation.snapshot.model}</dd><dt>Captured</dt><dd>{observation.snapshot.capturedAt}</dd><dt>Snapshot session</dt><dd>{observation.snapshot.providerSessionId}</dd></>}
      </dl>
    </details>
  </section>;
}

function SourceInventory({ inventory, error }: Pick<ContextInspectorViewProps, 'inventory'> & { error?: string }) {
  const [query, setQuery] = useState('');
  const rows = inventory?.rows ?? [];
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!`${row.pluginId} ${row.label} ${row.id} ${row.kind}`.toLowerCase().includes(query.toLowerCase())) continue;
    const group = groups.get(row.pluginId) ?? [];
    group.push(row);
    groups.set(row.pluginId, group);
  }
  return <div aria-label="Current source inventory">
    <div className="ci-section-heading"><h3>Plugin sources</h3><span>Current registrations</span></div>
    <p className="ci-intro">Available tools and skills, grouped by the plugin that supplies them.</p>
    <input className="ci-search" type="search" aria-label="Filter sources" placeholder="Filter plugins, tools and skills…" value={query} onChange={event => setQuery(event.target.value)} />
    {error && <p className="ci-alert" role="status">{error}</p>}
    {[...groups].map(([pluginId, items]) => <details className="ci-source-group" key={pluginId} open={query ? true : undefined}>
      <summary><span className="ci-source-name">{pluginId}</span><span className="ci-source-count">{items.filter(row => row.kind === 'agent-tool').length} {items.filter(row => row.kind === 'agent-tool').length === 1 ? 'tool' : 'tools'} · {items.filter(row => row.kind === 'skill').length} {items.filter(row => row.kind === 'skill').length === 1 ? 'skill' : 'skills'}</span><span className="ci-pill" data-disabled={!items[0]?.enabled}>{items[0]?.enabled ? 'Enabled' : 'Disabled'}</span></summary>
      <ul>{items.map((row, index) => <li key={`${row.id}-${index}`}><span>{row.label}<small>{row.id}</small></span><span className="ci-kind">{row.kind === 'agent-tool' ? 'Tool' : 'Skill'}</span></li>)}</ul>
    </details>)}
    {!error && groups.size === 0 && <div className="ci-empty"><strong>{query ? 'No matching sources' : 'No tool or skill registrations'}</strong><p>{query ? 'Try a plugin name or capability.' : 'No plugin inventory is available for this view.'}</p></div>}
    {inventory?.truncated && <p className="ci-note">Limited to 200 registrations.</p>}
    <p className="ci-note">Registrations do not prove inclusion in this session. External MCP tools and instruction bodies are outside this inventory.</p>
  </div>;

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
    <ContextInspectorView target={fixtureTarget} state={fixtures[selected]} ownerText={fixtureOwner} inventory={fixtureInventory} synthetic />
  </>;
}
