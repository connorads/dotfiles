import { useEffect, useRef } from 'react';
import { definePluginApp, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import { CaffeineChip } from './chip.tsx';
import { CaffeinePopover } from './popover.tsx';
import { close, receiveView, refresh, setClient, toggle, useCaffeine } from './store.ts';
import './app.css';

function Overlay() {
  setClient(useRpc<typeof rpcContract>());
  useRealtime('state', receiveView);
  // Realtime is not replayed, so read the state again after a reconnect or refocus.
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (connection === 'connected' && previous.current !== 'connected') void refresh();
    previous.current = connection;
  }, [connection]);
  useEffect(() => {
    void refresh();
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);
  const { view, open } = useCaffeine();
  return open ? <CaffeinePopover view={view} anchor={open.anchor} instant={open.instant} onClose={close} /> : null;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'popover', component: Overlay });
  app.slots.experimental_threadHeaderAction({ id: 'chip', title: 'Keep awake', component: CaffeineChip });
  // No isAvailable: the shortcut works on the new-thread screen, where no chip is mounted.
  app.commands.register({
    id: 'toggle', title: 'Toggle keep-awake controls', defaultShortcut: { key: 'k', alt: true },
    run: () => toggle('keyboard'),
  });
});
