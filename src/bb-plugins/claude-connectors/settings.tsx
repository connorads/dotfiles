import { useEffect, useRef, useState } from 'react';
import type { ToolRow } from './contracts.ts';
import { Retry } from './retry.tsx';
import { loadConnectors, message, reloadChoices, rpc, setProjectDefault, useConnectors } from './store.ts';

/** One profile's connector, so saves and errors stay with the list they were made in. */
const sourceKey = (profile: string, connector: string) => JSON.stringify([profile, connector]);
const toolKey = (source: string, tool: string) => JSON.stringify([source, tool]);

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

function Tools() {
  const { view, connectors } = useConnectors();
  const [profile, setProfile] = useState<string>('');
  const [connector, setConnector] = useState<string>('');
  /** The tools of `source`, so a late save never lands in another connector's list. */
  const [loaded, setLoaded] = useState<{ source: string; rows: ToolRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  /** Access changes in flight by `toolKey`, with the value being saved; their buttons wait for it. */
  const [saving, setSaving] = useState<ReadonlyMap<string, 'allow' | 'off'>>(new Map());
  const savingNow = useRef(saving);
  savingNow.current = saving;
  /** Failed access changes by `toolKey`, shown on their row until the next change of that tool. */
  const [failed, setFailed] = useState<ReadonlyMap<string, string>>(new Map());
  const chosen = profile || view?.profiles[0] || '';
  const source = sourceKey(chosen, connector);
  const tools = loaded?.source === source ? loaded.rows : null;
  const list = connectors.get(chosen);
  useEffect(() => { if (chosen) void loadConnectors(chosen); }, [chosen]);
  useEffect(() => {
    setLoaded(null); setError(null);
    if (!chosen || !connector) return;
    let live = true;
    rpc().call('tools', { profile: chosen, connector }).then(r => {
      if (!live) return;
      // A list fetched while a change is saving shows the value being saved.
      setLoaded({ source, rows: r.tools.map(row => ({ ...row, access: savingNow.current.get(toolKey(source, row.name)) ?? row.access })) });
      setError(r.error);
    }).catch(cause => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [chosen, connector]);

  /** Optimistic: the toggle moves at once and moves back if the save fails. */
  async function setAccess(tool: string, access: 'allow' | 'off') {
    const key = toolKey(source, tool);
    const before = tools?.find(row => row.name === tool)?.access;
    if (!before || before === access || saving.has(key)) return;
    const put = (value: 'allow' | 'off') => setLoaded(l => l?.source !== source ? l
      : { source, rows: l.rows.map(row => row.name === tool ? { ...row, access: value } : row) });
    const drop = <T,>(map: ReadonlyMap<string, T>) => { const next = new Map(map); next.delete(key); return next; };
    setFailed(drop);
    setSaving(s => new Map(s).set(key, access));
    put(access);
    try { await rpc().call('setAccess', { profile: chosen, connector, tool, access }); put(access); }
    catch (cause) { put(before); setFailed(f => new Map(f).set(key, message(cause))); }
    finally { setSaving(drop); }
  }

  const needle = filter.trim().toLowerCase();
  const shown = (tools ?? []).filter(t => t.name.toLowerCase().includes(needle));
  const allowed = (tools ?? []).filter(t => t.access === 'allow').length;
  if (view && view.profiles.length === 0) return <section className="cc-card">
    <h3>Tools</h3>
    <p className="cc-muted">No Claude profiles found. Sign in to Claude Code in a profile to list its connectors.</p>
  </section>;
  return <section className="cc-card">
    <h3>Tools</h3>
    <p className="cc-muted">Read-only tools are allowed by default. Tools that can write stay off until you allow them.</p>
    <div className="cc-toolbar">
      <select className="cc-select" aria-label="Profile" value={chosen} onChange={e => { setProfile(e.target.value); setConnector(''); }}>
        {(view?.profiles ?? []).map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <select className="cc-select" aria-label="Connector" value={connector} onChange={e => setConnector(e.target.value)}
        disabled={!list || list === 'loading' || list.list.length === 0}>
        <option value="">{!list || list === 'loading' ? 'Loading connectors…' : list.error ? 'Not available' : list.list.length === 0 ? 'No connectors' : 'Choose a connector'}</option>
        {list && list !== 'loading' && list.list.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      {tools && tools.length > 0 && <input className="cc-input" placeholder="Filter tools" value={filter} onChange={e => setFilter(e.target.value)} />}
    </div>
    {list && list !== 'loading' && list.error && <p className="cc-error">{list.error} <Retry /></p>}
    {error && <p className="cc-error">{error}</p>}
    {connector && !tools && !error && <p className="cc-muted">Loading tools…</p>}
    {tools && tools.length === 0 && !error && <p className="cc-muted">{connector} has no tools.</p>}
    {tools && tools.length > 0 && <>
      <p className="cc-muted">{allowed} of {tools.length} allowed</p>
      {shown.length === 0 && <p className="cc-muted">No tools match “{filter.trim()}”.</p>}
      <ul className="cc-tools">
        {shown.map(t => {
          const key = toolKey(source, t.name);
          const busy = saving.has(key) || undefined;
          const failure = failed.get(key);
          return <li key={t.name} className="cc-tool">
            <div className="cc-tool-text">
              <code>{t.name}</code>{!t.readOnly && <span className="cc-badge">writes</span>}
              <span className="cc-tool-desc" title={t.description}>{t.description.split('\n')[0]}</span>
              {failure && <span className="cc-error cc-tool-error" role="alert">Could not change access. {failure}</span>}
            </div>
            <span className="cc-seg" role="group" aria-label={`${t.name} access`} aria-busy={busy}>
              <button type="button" aria-pressed={t.access === 'allow'} aria-disabled={busy} onClick={() => void setAccess(t.name, 'allow')}>Allow</button>
              <button type="button" aria-pressed={t.access === 'off'} aria-disabled={busy} onClick={() => void setAccess(t.name, 'off')}>Off</button>
            </span>
          </li>;
        })}
      </ul>
    </>}
  </section>;
}

export function ConnectorsSettings() {
  const { view, stateError } = useConnectors();
  /** Failed default changes by `where` ('global' or a project id), each shown by its control until that control changes again. */
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  /** Default changes in flight by `where`, with the value being saved; the select shows it and ignores further changes. */
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
    : <p className="cc-muted">Loading…</p>;
  const projects = [...view.projects].sort((a, b) => a.name.localeCompare(b.name));
  return <div className="cc-settings">
    <section className="cc-card">
      <h3>Default</h3>
      <p className="cc-muted">Threads use their own pick first, then their project's default, then this.</p>
      <div className="cc-toolbar">
        <ProfileSelect label="Global default" value={saving.get('global') ?? view.defaultChoice} busy={saving.has('global')}
          onChange={value => void run('global', value, async () => { await rpc().call('setDefault', { value }); await reloadChoices(); })} />
        <span className="cc-muted">{view.profiles.length ? `Profiles from ${view.profiles.join(', ')}` : 'No profiles found'}</span>
      </div>
      {errorAt('global', 'the global default')}
    </section>
    <section className="cc-card">
      <h3>Projects</h3>
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
    <Tools />
  </div>;
}
