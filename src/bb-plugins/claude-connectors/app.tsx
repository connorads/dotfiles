import { useEffect, useRef } from 'react';
import { definePluginApp, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import { CHANGED, type rpcContract } from './contracts.ts';
import { DraftChip, HeaderChip } from './chip.tsx';
import { ConnectorsPopover } from './popover.tsx';
import { ConnectorsSettings } from './settings.tsx';
import { refresh, setClient, targetFor, toggle, useConnectors } from './store.ts';
import './app.css';

function useSync() {
  setClient(useRpc<typeof rpcContract>());
  useRealtime(CHANGED, () => { void refresh(); });
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
}

function Overlay() {
  useSync();
  const { open } = useConnectors();
  return open ? <ConnectorsPopover key={JSON.stringify(open.target)} open={open} /> : null;
}

function Settings() {
  useSync();
  return <ConnectorsSettings />;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'popover', component: Overlay });
  app.slots.experimental_threadHeaderAction({ id: 'chip', title: 'Claude connectors', component: HeaderChip });
  app.slots.settingsSection({ id: 'connectors', component: Settings });
  app.composer.customize({ id: 'connectors', scopes: ['new-thread'], actions: [{ id: 'connectors', component: DraftChip }] });
  app.commands.register({
    id: 'toggle', title: 'Choose Claude connectors', defaultShortcut: { key: 'k', alt: true },
    run: ({ threadId }) => toggle(targetFor(threadId ?? null), 'keyboard'),
  });
});
