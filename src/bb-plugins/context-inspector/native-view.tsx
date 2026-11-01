import type { NativeReport, NativeResult } from './native-contract';
import './native-view.css';

export interface NativeCostsProps {
  report: NativeResult | null;
  loading?: boolean;
  onCollect?: () => void;
  provider?: string;
  tracingEnabled?: boolean;
  onTracingChange?: (enabled: boolean) => void;
  onPurge?: () => void;
}
const tokens = (value: number) => value.toLocaleString('en-GB');
type Category = NativeReport['categories'][number];
function CategoryCosts({ category }: { category: Category }) {
  const entries = [...category.entries].sort((a, b) => b.tokens - a.tokens);
  const difference = category.tokens - entries.reduce((sum, entry) => sum + entry.tokens, 0);
  const sourceKind = category.kind === 'used' || category.kind === 'deferred';
  const discrepancy = !sourceKind ? null : difference > 0 ? `${tokens(difference)} tokens without source detail.`
    : difference < 0 ? `Source estimates exceed this total by ${tokens(-difference)} tokens. Values remain independently reported.` : null;
  const heading = <><span>{category.label}</span><span className="ci-native-count">{tokens(category.tokens)} <small>tokens</small></span></>;
  return <div className="ci-native-category">
    {entries.length ? <details><summary>{heading}</summary><div className="ci-native-entries">
      {entries.map((entry, index) => <div className="ci-native-entry" key={`${entry.id}-${index}`}><span>{entry.label}</span><span className="ci-native-count">{tokens(entry.tokens)} <small>tokens</small></span></div>)}
    </div></details> : <div className="ci-native-row">{heading}</div>}
    {discrepancy && <p className="ci-native-note">{discrepancy}</p>}
  </div>;
}

export function NativeCosts({ report, loading = false, onCollect, provider, tracingEnabled = false, onTracingChange, onPurge }: NativeCostsProps) {
  const available = report?.kind === 'available' ? report : null;
  const currentProvider = provider ?? available?.provider;
  const used = available?.categories.filter(category => category.kind === 'used') ?? [];
  const other = available?.categories.filter(category => category.kind !== 'used') ?? [];
  const scope = available?.scope === 'last-request' ? 'Last captured request' : 'Saved-session diagnostic';
  const captured = available ? new Date(available.capturedAt) : null;
  const validDate = captured && Number.isFinite(captured.getTime());
  return <section className="ci-native" aria-label="Native source costs" aria-busy={loading}>
    <div className="ci-native-heading"><h3>Native source costs</h3>
      {onCollect && (currentProvider === 'codex' || currentProvider === 'claude-code') && <button type="button" disabled={loading} onClick={onCollect}>{currentProvider === 'codex' ? 'Read latest request' : 'Read native summary'}</button>}
    </div>
    {currentProvider === 'codex' && onTracingChange && <div className="ci-native-recording">
      <label><span>Record future Codex requests</span><input type="checkbox" checked={tracingEnabled} disabled={loading} onChange={event => onTracingChange(event.target.checked)} /></label>
      <p className="ci-native-note">Raw diagnostic files include conversation and tool content. Applies when Codex next starts. Disabling recording does not stop a current writer. Existing requests are not recovered.</p>
    </div>}
    {loading && <p className="ci-native-note" role="status">Reading native source costs.</p>}
    {!loading && report?.kind === 'unavailable' && <p className="ci-native-note" role="status">{report.reason}</p>}
    {!loading && !report && <p className="ci-native-note">No native source-cost report has been read for this thread.</p>}
    {available && <>
      <div className="ci-native-scope"><span>{scope}</span><span className="ci-native-count">{tokens(available.totalTokens)} <small>estimated tokens</small></span></div>
      <p className="ci-native-note">{available.method}</p>
      {validDate && <p className="ci-native-capture">Captured <time dateTime={available.capturedAt}>{captured.toLocaleString('en-GB')}</time></p>}
      <div className="ci-native-used" role="region" aria-label="Used material estimates">
        {used.map((category, index) => <CategoryCosts category={category} key={`${category.id}-${index}`} />)}
      </div>
      {other.length > 0 && <div className="ci-native-other" role="region" aria-label="Capacity and deferred material">
        {other.map((category, index) => <div key={`${category.id}-${index}`}><span className="ci-native-kind">{category.kind}</span><CategoryCosts category={category} /></div>)}
      </div>}
      {available.notes.length > 0 && <ul className="ci-native-notes">{available.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    </>}
    {currentProvider === 'codex' && onPurge && <div className="ci-native-purge"><button type="button" disabled={loading || tracingEnabled} onClick={onPurge}>Delete recorded traces</button>{tracingEnabled && <span className="ci-native-note">Turn recording off before deleting.</span>}<span className="ci-native-note">Open trace bundles cannot be deleted.</span></div>}
  </section>;
}
