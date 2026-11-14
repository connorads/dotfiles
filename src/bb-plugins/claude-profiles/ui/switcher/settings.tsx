import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { KeyedProfile, rpcContract } from '../../contracts.ts';
import './switcher.css';

/** Connector preference per saved Claude account on this machine: set once, rarely changed. */
export function ConnectorSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [profiles, setProfiles] = useState<KeyedProfile[] | null>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [accounts, state] = await Promise.all([rpc.call('accounts', { threadId: null }), rpc.call('connectors.get', { threadId: null })]);
      setProfiles(accounts.supported ? accounts.profiles : []); setEnabled(state.accounts); setLoadError(null);
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : 'Could not read connector settings.'); }
  }, [rpc]);
  useEffect(() => { void load(); }, [load]);
  useRealtime('profiles-changed', () => { void load(); });
  async function toggle(profile: KeyedProfile) {
    // A second click before the disabled state renders must not send a second save.
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try { await rpc.call('connectors.account.set', { threadId: null, profileId: profile.id, enabled: !enabled[profile.id] }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change connector settings.'); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className="sw-settings">
    {profiles === null ? !loadError && <p role="status" className="sw-empty">Loading accounts…</p>
      : profiles.length === 0 ? <p role="status" className="sw-empty">No saved Claude accounts on a connected machine.</p>
      : <ul className="sw-list">{profiles.map(profile => <li key={profile.id} className="sw-row">
        <span className="sw-select"><span className="sw-key sw-key-inline" aria-hidden="true">{profile.key ?? '?'}</span>{profile.label}</span>
        <button type="button" role="switch" className="sw-pill" aria-checked={enabled[profile.id] === true} aria-pressed={enabled[profile.id] === true}
          aria-label={`${profile.label} connectors`} disabled={busy} onClick={() => { void toggle(profile); }}>{enabled[profile.id] ? 'On' : 'Off'}</button>
      </li>)}</ul>}
    {loadError && <div className="sw-error sw-settings-error">
      <span role="alert">{loadError}</span>
      <button type="button" className="sw-pill" onClick={() => { setLoadError(null); void load(); }}>Try again</button>
    </div>}
    {error && <p role="alert" className="sw-error">{error}</p>}
  </div>;
}
