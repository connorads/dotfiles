import { useCallback, useEffect, useState } from 'react';
import { useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { KeyedProfile, rpcContract } from '../../contracts.ts';
import './switcher.css';

/** Connector preference per saved Claude account on this machine: set once, rarely changed. */
export function ConnectorSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [profiles, setProfiles] = useState<KeyedProfile[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [accounts, state] = await Promise.all([rpc.call('accounts', { threadId: null }), rpc.call('connectors.get', { threadId: null })]);
      setProfiles(accounts.supported ? accounts.profiles : []); setEnabled(state.accounts); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read connector settings.'); }
  }, [rpc]);
  useEffect(() => { void load(); }, [load]);
  useRealtime('profiles-changed', () => { void load(); });
  async function toggle(profile: KeyedProfile) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await rpc.call('connectors.account.set', { threadId: null, profileId: profile.id, enabled: !enabled[profile.id] }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change connector settings.'); }
    finally { setBusy(false); }
  }
  return <div className="sw-settings">
    <ul className="sw-list">{profiles.map(profile => <li key={profile.id} className="sw-row">
      <span className="sw-select"><span className="sw-key sw-key-inline" aria-hidden="true">{profile.key ?? '?'}</span>{profile.label}</span>
      <button type="button" role="switch" className="sw-pill" aria-checked={enabled[profile.id] === true} aria-pressed={enabled[profile.id] === true}
        aria-label={`${profile.label} connectors`} disabled={busy} onClick={() => { void toggle(profile); }}>{enabled[profile.id] ? 'On' : 'Off'}</button>
    </li>)}</ul>
    {error && <p role="alert" className="sw-error">{error}</p>}
  </div>;
}
