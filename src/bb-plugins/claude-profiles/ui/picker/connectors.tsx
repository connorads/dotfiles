import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { Profile } from '../../contracts.ts';
import type { ConnectorState, connectorsContract } from '../../src/accounts/connectors-contract.ts';
import './connectors.css';

export function useConnectorSettings(threadId: string | null) {
  const rpc = useRpc<typeof connectorsContract>();
  const generation = useRef(0);
  const working = useRef(false);
  const [state, setState] = useState<ConnectorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const value = await rpc.call('connectors.get', { threadId });
      if (request === generation.current) { setState(value); setError(null); }
    } catch { if (request === generation.current) { setState(null); setError('Could not read account connector settings.'); } }
  }, [rpc, threadId]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useRealtime('profiles-changed', () => { void load(); });
  async function update(action: () => Promise<unknown>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null); generation.current++;
    try { await action(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change account connector settings.'); }
    finally { working.current = false; setBusy(false); }
  }
  return { state, busy, error, load,
    account: (profileId: string, enabled: boolean) => update(() => rpc.call('connectors.account.set', { threadId, profileId, enabled })),
  };
}
type Controls = ReturnType<typeof useConnectorSettings>;

export function ConnectorControls({ controls, threadId }: { controls: Controls; threadId: string | null }) {
  const { state, busy, error } = controls;
  const status = !state ? 'Access unknown' : !state.accounts[state.profileId] ? 'Off for this account'
    : state.mode === 'off' ? 'Off for this thread' : 'On for this account';
  const launch = !state || threadId === null ? null : state.restartPending ? 'Applies when this turn ends'
    : state.launch === 'pending' ? 'Applies on the next turn' : null;
  return <div className="cp-connectors">
    <p className="cp-launch" role="status"><span className="cp-status-dot" aria-hidden="true" />Connectors: {status}{launch && ` · ${launch}`}</p>
    {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={() => { void controls.load(); }}>Retry</button></p>}
  </div>;
}

export function AccountConnector({ controls, profile, disabled = false }: { controls: Controls; profile: Profile; disabled?: boolean }) {
  const { state, busy } = controls;
  const enabled = state?.accounts[profile.id] === true;
  return <button type="button" className="cp-account-access" role="switch" aria-label={`${profile.label} account connectors`}
    title={`${profile.label} connectors`}
    aria-checked={enabled} disabled={disabled || !state} aria-disabled={busy || undefined}
    onClick={() => { if (!busy) void controls.account(profile.id, !enabled); }}>
    <span>Connectors</span><span className="cp-switch-track" aria-hidden="true"><i /></span><span className="cp-switch-value">{enabled ? 'On' : 'Off'}</span>
  </button>;
}

export function AccountConnectors({ threadId, disabled, profiles }: { threadId: string | null; disabled: boolean; profiles: readonly Profile[] }) {
  const controls = useConnectorSettings(threadId);
  const selected = profiles.find(profile => profile.id === controls.state?.profileId);
  return <><ConnectorControls controls={controls} threadId={threadId} />
    {selected && <div className="cp-selected-account"><span>{selected.label}</span><AccountConnector controls={controls} profile={selected} disabled={disabled} /></div>}</>;
}
