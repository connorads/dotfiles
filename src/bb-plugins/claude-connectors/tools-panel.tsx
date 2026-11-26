import { useEffect, useRef, useState } from 'react';
import type { ToolRow } from './contracts.ts';
import { Retry } from './retry.tsx';
import { filterTools, isCustomOverride, pickDefaultProfile, summarizeTools, type ToolFilter } from './src/tools-view.ts';
import { loadConnectors, message, rpc, useConnectors } from './store.ts';

/** One profile's connector, so saves and errors stay with the list they were made in. */
const sourceKey = (profile: string, connector: string) => JSON.stringify([profile, connector]);
const toolKey = (source: string, tool: string) => JSON.stringify([source, tool]);

export type ReadOnlyNotice = {
  profile: string;
  busy?: boolean;
  onUseDirectly?: () => void;
};

export function ToolsPanel({ fixedProfile, initialConnector, compact = false, readOnlyNotice }: {
  fixedProfile?: string;
  initialConnector?: string;
  compact?: boolean;
  readOnlyNotice?: ReadOnlyNotice;
}) {
  const { view, connectors } = useConnectors();
  const [profile, setProfile] = useState<string>(fixedProfile ?? '');
  const [connector, setConnector] = useState<string>(initialConnector ?? '');
  const [loaded, setLoaded] = useState<{ source: string; rows: ToolRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<ToolFilter>('all');
  const [saving, setSaving] = useState<ReadonlyMap<string, 'allow' | 'off'>>(new Map());
  const savingNow = useRef(saving);
  savingNow.current = saving;
  const [failed, setFailed] = useState<ReadonlyMap<string, string>>(new Map());

  const profiles = view?.profiles ?? [];
  const chosen = fixedProfile ?? (profile && profiles.includes(profile)
    ? profile
    : pickDefaultProfile(profiles, view?.defaultChoice, view?.projects ?? [], connectors));

  const list = chosen ? connectors.get(chosen) : undefined;
  const connectorNames = list && list !== 'loading' && !list.error ? list.list : [];

  // Load connector list for the chosen profile (and check other profiles if none is pinned yet).
  useEffect(() => {
    if (chosen) void loadConnectors(chosen);
  }, [chosen]);

  // Auto-select the first connector when a profile's connectors load or when switching profiles.
  useEffect(() => {
    if (connectorNames.length === 0) return;
    if (connector && connectorNames.includes(connector)) return;
    if (initialConnector && connectorNames.includes(initialConnector)) {
      setConnector(initialConnector);
      return;
    }
    setConnector(connectorNames[0]!);
  }, [chosen, connectorNames.join('\0'), connector, initialConnector]);

  const activeConnector = connectorNames.includes(connector) ? connector : '';
  const source = sourceKey(chosen, activeConnector);
  const tools = loaded?.source === source ? loaded.rows : null;

  useEffect(() => {
    setLoaded(null);
    setError(null);
    if (!chosen || !activeConnector) return;
    let live = true;
    rpc().call('tools', { profile: chosen, connector: activeConnector }).then(result => {
      if (!live) return;
      setLoaded({
        source,
        rows: result.tools.map(row => ({ ...row, access: savingNow.current.get(toolKey(source, row.name)) ?? row.access })),
      });
      setError(result.error);
    }).catch(cause => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [chosen, activeConnector, source]);

  /** Optimistic: the toggle moves at once and moves back if the save fails. */
  async function setAccess(tool: string, access: 'allow' | 'off') {
    const key = toolKey(source, tool);
    const before = tools?.find(row => row.name === tool)?.access;
    if (!before || before === access || saving.has(key) || !activeConnector) return;
    const put = (value: 'allow' | 'off') => setLoaded(current => current?.source !== source ? current
      : { source, rows: current.rows.map(row => row.name === tool ? { ...row, access: value } : row) });
    const drop = <T,>(map: ReadonlyMap<string, T>) => { const next = new Map(map); next.delete(key); return next; };
    setFailed(drop);
    setSaving(current => new Map(current).set(key, access));
    put(access);
    try {
      await rpc().call('setAccess', { profile: chosen, connector: activeConnector, tool, access });
      put(access);
    } catch (cause) {
      put(before);
      setFailed(current => new Map(current).set(key, message(cause)));
    } finally {
      setSaving(drop);
    }
  }

  if (!fixedProfile && view && profiles.length === 0) {
    return <p className="cc-muted">No Claude profiles found. Sign in to Claude Code in a profile to list its connectors.</p>;
  }

  const summary = tools ? summarizeTools(tools) : null;
  const shown = tools ? filterTools(tools, filter, mode) : [];
  const useConnectorPills = compact && connectorNames.length > 0 && connectorNames.length <= 8;

  return <div className={compact ? 'cc-tools-panel cc-tools-panel-compact' : 'cc-tools-panel'}>
    {readOnlyNotice && <div className="cc-callout" role="note">
      <p>
        This thread inherited read-only access from its parent thread, so write tools stay blocked here even when allowed on <strong>{readOnlyNotice.profile}</strong>.
      </p>
      {readOnlyNotice.onUseDirectly && <button type="button" className="cc-btn-inline"
        aria-disabled={readOnlyNotice.busy || undefined} aria-busy={readOnlyNotice.busy || undefined}
        onClick={readOnlyNotice.onUseDirectly}>
        {readOnlyNotice.busy ? 'Switching…' : `Use ${readOnlyNotice.profile} directly for this thread`}
      </button>}
    </div>}

    {useConnectorPills ? <div className="cc-connector-pills" role="tablist" aria-label="Connectors">
      {connectorNames.map(name => <button key={name} type="button" role="tab" className="cc-conn-pill"
        aria-selected={name === activeConnector}
        onClick={() => { setConnector(name); setFilter(''); }}>
        {name}
      </button>)}
    </div> : <div className="cc-toolbar">
      {!fixedProfile && <select className="cc-select" aria-label="Profile" value={chosen}
        onChange={e => { setProfile(e.target.value); setConnector(''); setFilter(''); }}>
        {profiles.map(p => <option key={p} value={p}>{p}</option>)}
      </select>}
      <select className="cc-select" aria-label="Connector" value={activeConnector}
        onChange={e => { setConnector(e.target.value); setFilter(''); }}
        disabled={!list || list === 'loading' || connectorNames.length === 0}>
        <option value="">
          {!list || list === 'loading' ? 'Loading connectors…' : list.error ? 'Not available' : connectorNames.length === 0 ? 'No connectors' : 'Choose a connector'}
        </option>
        {connectorNames.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
    </div>}

    {list && list !== 'loading' && list.error && <p className="cc-error" role="alert">{list.error} <Retry /></p>}
    {error && <p className="cc-error" role="alert">{error}</p>}
    {activeConnector && !tools && !error && <p className="cc-muted" role="status">Loading {activeConnector} tools…</p>}
    {tools && tools.length === 0 && !error && <p className="cc-muted">{activeConnector} has no tools.</p>}

    {tools && tools.length > 0 && summary && <>
      <div className="cc-tools-controls">
        <div className="cc-search-wrap">
          <input className="cc-input cc-search-input" type="search" aria-label="Filter tools"
            placeholder="Filter tools…" value={filter} onChange={e => setFilter(e.target.value)} />
          {filter && <button type="button" className="cc-search-clear" aria-label="Clear filter"
            onClick={() => setFilter('')}>×</button>}
        </div>
        <div className="cc-filter-tabs" role="group" aria-label="Filter tools by type">
          <button type="button" className="cc-filter-pill" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>
            All <span className="cc-count">{summary.total}</span>
          </button>
          <button type="button" className="cc-filter-pill" aria-pressed={mode === 'writes'} onClick={() => setMode('writes')}>
            Writes <span className="cc-count">{summary.writes}</span>
          </button>
          <button type="button" className="cc-filter-pill" aria-pressed={mode === 'allowed'} onClick={() => setMode('allowed')}>
            Allowed <span className="cc-count">{summary.allowed}</span>
          </button>
        </div>
      </div>

      <div className="cc-tools-meta">
        <span className="cc-muted">
          {filter.trim() || mode !== 'all'
            ? `Showing ${shown.length} of ${summary.total}`
            : `${summary.allowed} of ${summary.total} allowed`}
          {summary.writes > 0 ? ` · ${summary.writesAllowed} of ${summary.writes} writes allowed` : ' · read-only connector'}
        </span>
      </div>

      {shown.length === 0 ? <p className="cc-muted cc-tools-empty">
        No tools match{filter.trim() ? ` “${filter.trim()}”` : ''}{mode !== 'all' ? ` in ${mode}` : ''}.
      </p> : <ul className={compact ? 'cc-tools cc-tools-scroll' : 'cc-tools'}>
        {shown.map(t => {
          const key = toolKey(source, t.name);
          const busy = saving.has(key) || undefined;
          const failure = failed.get(key);
          const custom = isCustomOverride(t);
          const writeAllowed = !t.readOnly && t.access === 'allow';
          return <li key={t.name} className="cc-tool" data-write-allowed={writeAllowed ? '' : undefined}>
            <div className="cc-tool-text">
              <div className="cc-tool-head">
                <code>{t.name}</code>
                {!t.readOnly && <span className="cc-badge cc-badge-write">writes</span>}
                {custom && <span className="cc-badge cc-badge-custom">custom</span>}
              </div>
              {t.description && <span className="cc-tool-desc" title={t.description}>{t.description.split('\n')[0]}</span>}
              {failure && <span className="cc-error cc-tool-error" role="alert">Could not change access. {failure}</span>}
            </div>
            <span className="cc-seg" role="group" aria-label={`${t.name} access`} aria-busy={busy}>
              <button type="button" data-kind="allow" data-tone={!t.readOnly ? 'write' : 'read'}
                aria-pressed={t.access === 'allow'} aria-disabled={busy}
                onClick={() => void setAccess(t.name, 'allow')}>Allow</button>
              <button type="button" data-kind="off"
                aria-pressed={t.access === 'off'} aria-disabled={busy}
                onClick={() => void setAccess(t.name, 'off')}>Off</button>
            </span>
          </li>;
        })}
      </ul>}
    </>}
  </div>;
}
