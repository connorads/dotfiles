import { useEffect, useState } from 'react';
import type { ToolRow } from './contracts.ts';
import { loadConnectors, message, refresh, rpc, setProjectDefault, useConnectors } from './store.ts';

function ProfileSelect({ value, onChange, inherit, label }: { value: string; onChange: (v: string) => void; inherit?: string; label: string }) {
  const { view } = useConnectors();
  return <select className="cc-select" aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
    {inherit && <option value="inherit">{inherit}</option>}
    <option value="off">Off</option>
    {(view?.profiles ?? []).map(p => <option key={p} value={p}>{p}</option>)}
  </select>;
}

function Tools() {
  const { view, connectors } = useConnectors();
  const [profile, setProfile] = useState<string>('');
  const [connector, setConnector] = useState<string>('');
  const [tools, setTools] = useState<ToolRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const chosen = profile || view?.profiles[0] || '';
  const list = connectors.get(chosen);
  useEffect(() => { if (chosen) void loadConnectors(chosen); }, [chosen]);
  useEffect(() => {
    setTools(null); setError(null);
    if (!chosen || !connector) return;
    let live = true;
    rpc().call('tools', { profile: chosen, connector }).then(r => { if (live) { setTools(r.tools); setError(r.error); } })
      .catch(cause => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [chosen, connector]);

  async function setAccess(tool: string, access: 'allow' | 'off') {
    setTools(t => t?.map(row => row.name === tool ? { ...row, access } : row) ?? t);
    try { await rpc().call('setAccess', { profile: chosen, connector, tool, access }); }
    catch (cause) { setError(message(cause)); }
  }

  const shown = (tools ?? []).filter(t => t.name.includes(filter.trim()));
  const allowed = (tools ?? []).filter(t => t.access === 'allow').length;
  return <section className="cc-card">
    <h3>Tools</h3>
    <p className="cc-muted">Read-only tools are allowed by default. Tools that can write stay off until you allow them.</p>
    <div className="cc-toolbar">
      <select className="cc-select" aria-label="Profile" value={chosen} onChange={e => { setProfile(e.target.value); setConnector(''); }}>
        {(view?.profiles ?? []).map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <select className="cc-select" aria-label="Connector" value={connector} onChange={e => setConnector(e.target.value)}
        disabled={!list || list === 'loading' || list.list.length === 0}>
        <option value="">{!list || list === 'loading' ? 'Loading connectors…' : list.error ? 'Not available' : 'Choose a connector'}</option>
        {list && list !== 'loading' && list.list.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      {tools && <input className="cc-input" placeholder="Filter tools" value={filter} onChange={e => setFilter(e.target.value)} />}
    </div>
    {list && list !== 'loading' && list.error && <p className="cc-error">{list.error}</p>}
    {error && <p className="cc-error">{error}</p>}
    {connector && !tools && !error && <p className="cc-muted">Loading tools…</p>}
    {tools && <>
      <p className="cc-muted">{allowed} of {tools.length} allowed</p>
      <ul className="cc-tools">
        {shown.map(t => <li key={t.name} className="cc-tool">
          <div className="cc-tool-text">
            <code>{t.name}</code>{!t.readOnly && <span className="cc-badge">writes</span>}
            <span className="cc-tool-desc" title={t.description}>{t.description.split('\n')[0]}</span>
          </div>
          <span className="cc-seg" role="group" aria-label={`${t.name} access`}>
            <button type="button" aria-pressed={t.access === 'allow'} onClick={() => void setAccess(t.name, 'allow')}>Allow</button>
            <button type="button" aria-pressed={t.access === 'off'} onClick={() => void setAccess(t.name, 'off')}>Off</button>
          </span>
        </li>)}
      </ul>
    </>}
  </section>;
}

export function ConnectorsSettings() {
  const { view } = useConnectors();
  const [error, setError] = useState<string | null>(null);
  const run = (task: () => Promise<unknown>) => { setError(null); task().catch(cause => setError(message(cause))); };
  if (!view) return <p className="cc-muted">Loading…</p>;
  const projects = [...view.projects].sort((a, b) => a.name.localeCompare(b.name));
  return <div className="cc-settings">
    {error && <p className="cc-error" role="alert">{error}</p>}
    <section className="cc-card">
      <h3>Default</h3>
      <p className="cc-muted">Threads use their own pick first, then their project's default, then this.</p>
      <div className="cc-toolbar">
        <ProfileSelect label="Global default" value={view.defaultChoice}
          onChange={value => run(async () => { await rpc().call('setDefault', { value }); await refresh(); })} />
        <span className="cc-muted">Profiles from {view.profiles.length ? view.profiles.join(', ') : 'none found'}</span>
      </div>
    </section>
    <section className="cc-card">
      <h3>Projects</h3>
      <table className="cc-table">
        <thead><tr><th>Project</th><th>Connectors</th></tr></thead>
        <tbody>{projects.map(p => <tr key={p.id}>
          <td>{p.name}</td>
          <td><ProfileSelect label={`${p.name} default`} value={p.choice ?? 'inherit'}
            inherit={`Global default (${view.defaultChoice})`}
            onChange={value => run(() => setProjectDefault(p.id, value))} /></td>
        </tr>)}</tbody>
      </table>
    </section>
    <Tools />
  </div>;
}
