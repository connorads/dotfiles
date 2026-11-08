import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import { rpcContract } from './contracts';
import type { LabState } from './lab-model';
import { LabView } from './lab-view';
export function LabPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [state, setState] = useState<LabState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const request = useCallback(async (method: 'labStatus' | 'prepareLab' | 'runLab' | 'reconcileLab', input: Record<string, never> | { id: string; revision: number }) => {
    const id = ++generation.current;
    setPending(true); setError(null);
    try { const result = await rpc.call(method, input); if (id === generation.current) setState(result); }
    catch { if (id === generation.current) setError('Rehearsal connection unavailable. Reconnect and refresh the saved operation.'); }
    finally { if (id === generation.current) setPending(false); }
  }, [rpc]);
  useEffect(() => {
    if (connection === 'connected') void request('labStatus', {});
    else { generation.current++; setPending(false); setState(null); setError('Server connection unavailable. Reconnect before continuing.'); }
    return () => { generation.current++; };
  }, [connection, request]);
  const active = state?.kind === 'available' && ['preparing', 'rehearsing'].includes(state.lab.phase);
  useEffect(() => {
    if (!active || pending || connection !== 'connected') return;
    const timer = setTimeout(() => { void request('labStatus', {}); }, 1500);
    return () => clearTimeout(timer);
  }, [active, pending, connection, request]);
  return <LabView state={state} pending={pending || connection !== 'connected'} error={error}
    onPrepare={() => { void request('prepareLab', {}); }} onRefresh={() => { void request('labStatus', {}); }}
    onRun={(id, revision) => { void request('runLab', { id, revision }); }}
    onReconcile={(id, revision) => { void request('reconcileLab', { id, revision }); }} />;
}
