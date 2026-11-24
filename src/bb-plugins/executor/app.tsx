import { useEffect, useRef } from 'react';
import { definePluginApp, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import { registerThreadHeaderChip } from '@bb-plugins/chip/header';
import { STATE_CHANGED, THREAD_CHANGED, type rpcContract } from './contracts.ts';
import { ExecutorChip } from './chip.tsx';
import { DraftConnection } from './draft.tsx';
import { ExecutorPopover } from './popover.tsx';
import { ExecutorSettings } from './settings.tsx';
import { checkOne, close, loadChoice, loadOwner, refresh, setClient, toggle, useExecutor } from './store.ts';
import './app.css';

/** Keeps the shared store current. Mounted by the overlay and the settings section. */
function useSync() {
  setClient(useRpc<typeof rpcContract>());
  useRealtime(STATE_CHANGED, () => { void refresh(); });
  useRealtime(THREAD_CHANGED, payload => {
    const id = (payload as { threadId: string }).threadId;
    void loadChoice(id);
    void loadOwner(id);
  });
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
  // When a connection finishes signing in, probe it immediately to populate its live apps and status.
  const { view } = useExecutor();
  const previousStatuses = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!view) return;
    const prev = previousStatuses.current;
    for (const item of view.connections) {
      if (prev.get(item.id) === 'signing-in' && item.status === 'signed-in' && (item.health?.state ?? 'unknown') === 'unknown') {
        void checkOne(item.id, true);
      }
    }
    previousStatuses.current = new Map(view.connections.map(c => [c.id, c.status]));
  }, [view]);
}

function Overlay() {
  useSync();
  const { view, loadError, choices, owners, saves, draft, open, unsaved } = useExecutor();
  return open ? <ExecutorPopover
    view={view}
    loadError={loadError}
    threadId={open.threadId}
    projectId={open.projectId}
    choice={open.threadId ? choices.get(open.threadId) : draft}
    owner={open.threadId ? (owners.get(open.threadId) ?? null) : null}
    saving={open.threadId ? saves.get(open.threadId) : undefined}
    unsaved={unsaved && unsaved.threadId === open.threadId ? unsaved.message : null}
    anchor={open.anchor}
    instant={open.instant}
    onClose={close}
  /> : null;
}

function Settings() {
  useSync();
  return <ExecutorSettings />;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'popover', component: Overlay });
  registerThreadHeaderChip(app, { id: 'chip', title: 'Executor connection', component: ExecutorChip });
  app.slots.settingsSection({ id: 'connections', component: Settings });
  app.composer.customize({ id: 'connection', scopes: ['new-thread'], actions: [{ id: 'connection', component: DraftConnection }] });
  app.commands.register({
    id: 'toggle', title: 'Choose Executor connection', defaultShortcut: { key: 'e', alt: true },
    run: ({ threadId, projectId }) => toggle(threadId ?? null, 'keyboard', undefined, projectId ?? undefined),
  });
});
