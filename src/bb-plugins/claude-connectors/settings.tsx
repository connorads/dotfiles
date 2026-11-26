import { useRef, useState } from 'react';
import { Retry } from './retry.tsx';
import { message, reloadChoices, rpc, setProjectDefault, useConnectors } from './store.ts';
import { ToolsPanel } from './tools-panel.tsx';

function ProfileSelect({ value, onChange, inherit, label, busy }: { value: string; onChange: (v: string) => void; inherit?: string; label: string; busy: boolean }) {
  const { view } = useConnectors();
  const profiles = view?.profiles ?? [];
  // A stored profile whose directory is gone still applies, so the select names it rather than falling back to "Off".
  const missing = value !== 'off' && value !== 'inherit' && !profiles.includes(value);
  return <select className="cc-select" aria-label={label} value={value} aria-busy={busy || undefined} onChange={e => onChange(e.target.value)}>
    {inherit && <option value="inherit">{inherit}</option>}
    <option value="off">Off</option>
    {profiles.map(p => <option key={p} value={p}>{p}</option>)}
    {missing && <option value={value}>{value} (not found)</option>}
  </select>;
}

export function ConnectorsSettings() {
  const { view, stateError } = useConnectors();
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [saving, setSaving] = useState<ReadonlyMap<string, string>>(new Map());
  const busy = useRef(new Set<string>());

  async function run(where: string, value: string, task: () => Promise<unknown>) {
    if (busy.current.has(where)) return;
    busy.current.add(where);
    setErrors(e => { const next = new Map(e); next.delete(where); return next; });
    setSaving(s => new Map(s).set(where, value));
    try { await task(); } catch (cause) { setErrors(e => new Map(e).set(where, message(cause))); }
    finally {
      busy.current.delete(where);
      setSaving(s => { const next = new Map(s); next.delete(where); return next; });
    }
  }

  const errorAt = (where: string, what: string) => errors.has(where)
    ? <p className="cc-error cc-field-error" role="alert">Could not change {what}. {errors.get(where)}</p> : null;

  if (!view) return stateError
    ? <p className="cc-error" role="alert">Could not load Claude connectors. {stateError} <Retry /></p>
    : <p className="cc-muted" role="status">Loading…</p>;

  const projects = [...view.projects].sort((a, b) => a.name.localeCompare(b.name));
  const customProjects = projects.filter(p => p.choice !== null).length;

  return <div className="cc-settings">
    <section className="cc-card">
      <div className="cc-card-head">
        <h3>Tool permissions</h3>
      </div>
      <p className="cc-muted">Read-only tools are allowed by default. Write tools stay off until you allow them per profile.</p>
      <ToolsPanel />
    </section>

    <section className="cc-card">
      <div className="cc-card-head">
        <h3>Default profile</h3>
      </div>
      <p className="cc-muted">Threads use their own pick first, then their parent thread, then their project default, then this.</p>
      <div className="cc-toolbar">
        <ProfileSelect label="Global default" value={saving.get('global') ?? view.defaultChoice} busy={saving.has('global')}
          onChange={value => void run('global', value, async () => { await rpc().call('setDefault', { value }); await reloadChoices(); })} />
        <span className="cc-muted">{view.profiles.length ? `Profiles: ${view.profiles.join(', ')}` : 'No profiles found'}</span>
      </div>
      {errorAt('global', 'the global default')}
    </section>

    <section className="cc-card">
      <div className="cc-card-head">
        <h3>Project defaults</h3>
        {projects.length > 0 && <span className="cc-muted">
          {customProjects > 0 ? `${customProjects} custom of ${projects.length}` : `${projects.length} inheriting`}
        </span>}
      </div>
      {projects.length === 0 ? <p className="cc-muted">No projects yet.</p> : <table className="cc-table">
        <thead><tr><th>Project</th><th>Connectors</th></tr></thead>
        <tbody>{projects.map(p => <tr key={p.id}>
          <td>{p.name}{errorAt(p.id, `the default for ${p.name}`)}</td>
          <td><ProfileSelect label={`${p.name} default`} value={saving.get(p.id) ?? p.choice ?? 'inherit'} busy={saving.has(p.id)}
            inherit={`Global default (${view.defaultChoice})`}
            onChange={value => void run(p.id, value, () => setProjectDefault(p.id, value))} /></td>
        </tr>)}</tbody>
      </table>}
    </section>
  </div>;
}
