import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { definePluginApp, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import { CHANGED, type rpcContract, type StateView, type ThreadView } from './contracts.ts';
import { AwsPicker } from './picker.tsx';
import './app.css';

/** The thread the picker is open for, or null when closed. */
let openFor: string | null = null;
const listeners = new Set<() => void>();
const setOpen = (threadId: string | null) => { openFor = threadId; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function Overlay() {
  const threadId = useSyncExternalStore(subscribe, () => openFor);
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<StateView | null>(null);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const refresh = useCallback(async () => {
    if (!threadId) return;
    const [nextState, nextThread] = await Promise.all([rpc.call('state', null), rpc.call('thread', { threadId })]);
    setState(nextState);
    setThread(nextThread);
  }, [rpc, threadId]);
  useRealtime(CHANGED, () => { void refresh(); });
  useEffect(() => { setState(null); setThread(null); void refresh(); }, [refresh]);
  if (!threadId) return null;
  return <AwsPicker rpc={rpc} threadId={threadId} state={state} thread={thread} refresh={refresh} onClose={() => setOpen(null)} />;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'picker', component: Overlay });
  app.commands.register({
    id: 'choose', title: 'Choose AWS profile', defaultShortcut: { key: 'w', alt: true },
    // A thread's agent reads its credentials live, so the choice needs a thread, not a draft.
    run: ({ threadId }) => setOpen(openFor ? null : threadId ?? null),
  });
});
