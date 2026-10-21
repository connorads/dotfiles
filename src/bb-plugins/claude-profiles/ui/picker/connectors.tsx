import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { ConnectorState, connectorsContract } from '../../src/accounts/connectors-contract.ts';
import './connectors.css';

export function AccountConnectors({ threadId, disabled }: { threadId: string | null; disabled: boolean }) {
  const rpc = useRpc<typeof connectorsContract>();
  const id = useId();
  const generation = useRef(0);
  const working = useRef(false);
  const [state, setState] = useState<ConnectorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    const request = ++generation.current;
    rpc.call('connectors.get', { threadId }).then(value => {
      if (request === generation.current) { setState(value); setError(null); }
    }, () => { if (request === generation.current) { setState(null); setError('Could not read account connector access.'); } });
  }, [rpc, threadId]);
  useEffect(() => { load(); return () => { generation.current++; }; }, [load, disabled]);
  useRealtime('profiles-changed', load);
  async function toggle() {
    if (threadId === null || !state || disabled || working.current) return;
    working.current = true; setBusy(true); setError(null); generation.current++;
    try { setState(await rpc.call('connectors.set', { threadId, enabled: !state.enabled })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change account connector access.'); }
    finally { working.current = false; setBusy(false); }
  }
  const status = threadId === null ? 'New threads start off. Enable access after creating the thread.' : !state ? 'Access unknown' : state.launch === 'pending'
    ? 'Applies when the next turn starts'
    : state.launch === 'unknown' ? 'Launch access could not be verified'
      : state.launch === 'off' ? state.enabled ? 'Requested on, but off at launch' : 'Off at launch'
        : state.enabled ? 'On requested at launch. Claude settings can still block access.' : 'Requested off, but on at launch';
  return <div className="cp-connectors">
    <div className="cp-connectors-row">
      <span id={`${id}-label`}>Claude account connectors</span>
      <button type="button" className="mf-account-button" role="switch" aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-help`} aria-checked={state?.enabled ?? false}
        disabled={threadId === null || disabled || busy || !state} onClick={() => { void toggle(); }}>
        {state ? state.enabled ? 'On' : 'Off' : 'Unknown'}
      </button>
    </div>
    <p id={`${id}-help`}>Apps connected through Claude, including Slack. Executor keeps its own connection.</p>
    <p role="status">{status}</p>
    {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={load}>Retry</button></p>}
  </div>;
}
