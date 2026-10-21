import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
    global: (blocked: boolean) => update(() => rpc.call('connectors.global.set', { blocked })),
    account: (profileId: string, enabled: boolean) => update(() => rpc.call('connectors.account.set', { threadId, profileId, enabled })),
    mode: (mode: ConnectorState['mode']) => threadId === null ? Promise.resolve()
      : update(() => rpc.call('connectors.set', { threadId, mode })),
    restart: () => update(() => rpc.call('connectors.restart', {})),
  };
}
type Controls = ReturnType<typeof useConnectorSettings>;

export function ConnectorControls({ controls, threadId, disabled }: { controls: Controls; threadId: string | null; disabled: boolean }) {
  const { state, busy, error } = controls;
  const id = useId();
  const status = !state ? 'Access unknown' : state.globalBlocked ? 'Blocked globally'
    : !state.accounts[state.profileId] ? 'Off for this account' : state.mode === 'off' ? 'Off for this thread' : 'Allowed by account settings';
  const launch = !state || threadId === null ? null : state.launch === 'pending' ? 'Applies when the next turn starts'
    : state.launch === 'unknown' ? 'Launch access could not be verified'
      : state.launch === 'off' ? 'Off at launch' : 'On requested at launch. Claude settings can still block access.';
  return <div className="cp-connectors">
    <div className="cp-connectors-row">
      <span id={`${id}-label`}>Claude account connectors</span>
      <button type="button" className="mf-account-button" role="switch" aria-label="Allow account connectors in BB"
        aria-describedby={`${id}-help`} aria-checked={state ? !state.globalBlocked : false}
        disabled={busy || !state} onClick={() => { if (state) void controls.global(!state.globalBlocked); }}>
        {state ? state.globalBlocked ? 'Block all' : 'Use account settings' : 'Unknown'}
      </button>
    </div>
    <p id={`${id}-help`}>Applies across BB. Executor keeps its own connection.</p>
    {threadId !== null && <label className="cp-connectors-row">This thread
      <select aria-label="This thread's connectors" value={state?.mode ?? 'off'} disabled={disabled || busy || !state}
        onChange={event => { void controls.mode(event.target.value === 'account' ? 'account' : 'off'); }}>
        <option value="account">Use account setting</option><option value="off">Off</option>
      </select>
    </label>}
    <p role="status">{status}{launch && ` · ${launch}`}</p>
    {!!state?.pending && <div className="cp-connectors-pending" role="status">
      <p>{state.pending} sessions still need a restart. Active turns keep their launch access until stopped.</p>
      <button type="button" className="mf-account-button" disabled={busy} onClick={() => { void controls.restart(); }}>Stop pending sessions now</button>
    </div>}
    {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={() => { void controls.load(); }}>Retry</button></p>}
  </div>;
}

export function AccountConnector({ controls, profile, disabled = false }: { controls: Controls; profile: Profile; disabled?: boolean }) {
  const { state, busy } = controls;
  const enabled = state?.accounts[profile.id] === true;
  return <div className="cp-account-access"><span>Account connectors</span>
    <button type="button" className="mf-account-button" role="switch" aria-label={`${profile.label} account connectors`}
      aria-checked={enabled} disabled={disabled || busy || !state}
      onClick={() => { void controls.account(profile.id, !enabled); }}>{enabled ? 'On' : 'Off'}</button>
  </div>;
}

export function AccountConnectors({ threadId, disabled, profiles }: { threadId: string | null; disabled: boolean; profiles: readonly Profile[] }) {
  const controls = useConnectorSettings(threadId);
  const selected = profiles.find(profile => profile.id === controls.state?.profileId);
  return <><ConnectorControls controls={controls} threadId={threadId} disabled={disabled} />
    {selected && <AccountConnector controls={controls} profile={selected} />}</>;
}
