import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { definePluginApp, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import { ChipPopover } from '@bb-plugins/chip';
import { rpcContract } from './contracts';
import type { Snapshot } from './model';
import { PatchView } from './view';
import './app.css';

let opened: { focus: HTMLElement | null } | null = null;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function close() { opened = null; listeners.forEach(listener => listener()); }
function show() {
  if (opened) return;
  opened = { focus: document.activeElement instanceof HTMLElement ? document.activeElement : null };
  listeners.forEach(listener => listener());
}
function Popup({ focus }: { focus: HTMLElement | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [data, setData] = useState<{ hostId: string | null; snapshot: Snapshot } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let current = true;
    setData(null);
    setError(null);
    if (connection !== 'connected') { setLoading(false); setError('Server connection unavailable'); return; }
    setLoading(true);
    rpc.call('inspect', {}).then(value => { if (current) setData(value); }, () => { if (current) setError('Patch inspection unavailable'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [rpc, connection, attempt]);
  return <ChipPopover ref={dialog} aria-label="Patches" trigger={() => focus?.isConnected ? focus : null} anchor={null} width={580}
    instant panelClassName="ph-panel" onClose={close}
    place={() => { const width = Math.min(580, window.innerWidth - 24); return { width, left: (window.innerWidth - width) / 2, top: 24, origin: 'top center' }; }}>
    <PatchView snapshot={data?.snapshot ?? null} hostId={data?.hostId ?? null} loading={loading} error={error}
      onRefresh={() => setAttempt(value => value + 1)} onClose={close} />
  </ChipPopover>;
}
function Overlay() {
  const state = useSyncExternalStore(subscribe, () => opened);
  return state ? <Popup focus={state.focus} /> : null;
}
export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'patches', component: Overlay });
  app.commands.register({ id: 'show', title: 'Patches', run: show });
});
