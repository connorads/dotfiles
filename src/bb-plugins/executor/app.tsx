import { useEffect, useRef } from 'react';
import { definePluginApp, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import { STATE_CHANGED, THREAD_CHANGED, type rpcContract } from './contracts.ts';
import { ExecutorChip } from './chip.tsx';
import { ExecutorPopover } from './popover.tsx';
import { ExecutorSettings } from './settings.tsx';
import { close, loadChoice, refresh, setClient, toggle, useExecutor } from './store.ts';
import './app.css';

/** Keeps the shared store current. Mounted by the overlay and the settings section. */
function useSync() {
  setClient(useRpc<typeof rpcContract>());
  useRealtime(STATE_CHANGED, () => { void refresh(); });
  useRealtime(THREAD_CHANGED, payload => { void loadChoice((payload as { threadId: string }).threadId); });
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
}

function Overlay() {
  useSync();
  const { view, choices, open } = useExecutor();
  return open ? <ExecutorPopover view={view} threadId={open.threadId} choice={open.threadId ? choices.get(open.threadId) : undefined}
    anchor={open.anchor} instant={open.instant} onClose={close} /> : null;
}

function Settings() {
  useSync();
  return <ExecutorSettings />;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'popover', component: Overlay });
  app.slots.experimental_threadHeaderAction({ id: 'chip', title: 'Executor connection', component: ExecutorChip });
  app.slots.settingsSection({ id: 'connections', component: Settings });
  app.commands.register({
    id: 'toggle', title: 'Choose Executor connection', defaultShortcut: { key: 'e', alt: true },
    run: ({ threadId }) => toggle(threadId ?? null, 'keyboard'),
  });
});
