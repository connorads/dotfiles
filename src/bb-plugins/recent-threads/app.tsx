import { useEffect } from 'react';
import {
  definePluginApp,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginRpcClient,
} from '@get-bb/plugin-sdk/app';
import { viewSchema, type RecentView, type rpcContract } from './contracts.ts';
import { mountChrome } from './src/footer.ts';
import { isArchivedOnly, isRecentMode } from './src/mode.ts';
import './app.css';

// Commands and footer actions run outside React, so bridge the RPC client and
// latest state through a module store fed by an always-mounted null overlay.
type Rpc = PluginRpcClient<typeof rpcContract>;
let client: Rpc | null = null;
let view: RecentView | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const receive = (next: unknown) => {
  view = viewSchema.parse(next);
  notify();
};
const report = (cause: unknown) =>
  console.error(`recent-threads: ${cause instanceof Error ? cause.message : String(cause)}`);

function refresh(rpcClient: Rpc | null = client) {
  if (!rpcClient) return;
  void rpcClient.call('view', {}).then(receive, report);
}

function run(method: 'toggle' | 'toggleArchived') {
  if (!client) {
    report(new Error('Recent Threads is still loading.'));
    return;
  }
  void client.call(method, {}).then(receive, report);
}
const toggle = () => run('toggle');
const toggleArchived = () => run('toggleArchived');

function StateBridge() {
  const rpcClient = useRpc<typeof rpcContract>();
  const connectionState = useRealtimeConnectionState();

  client = rpcClient;
  useRealtime('state', receive);

  useEffect(() => {
    refresh(rpcClient);
    const onFocus = () => refresh(rpcClient);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh(rpcClient);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      if (client === rpcClient) client = null;
    };
  }, [rpcClient]);

  useEffect(() => {
    if (connectionState === 'connected') refresh(rpcClient);
  }, [connectionState, rpcClient]);

  return null;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'state', component: StateBridge });
  app.experimental_sidebarFooter.register({
    kind: 'action',
    id: 'toggle',
    label: 'Recent threads',
    icon: 'Clock',
    onActivate: toggle,
  });
  app.experimental_sidebarFooter.register({
    kind: 'action',
    id: 'archived',
    label: 'Archived threads',
    icon: 'Archive',
    onActivate: toggleArchived,
  });
  app.contentScripts.register({
    id: 'footer-chrome',
    mount: () => mountChrome(document, {
      items: {
        toggle: () => view !== null && isRecentMode(view.mode),
        archived: () => view !== null && isArchivedOnly(view.lifecycles),
      },
      subscribe,
    }),
  });
  app.commands.register({
    id: 'toggle',
    title: 'Toggle recent threads view',
    defaultShortcut: { key: 'r', alt: true },
    run: toggle,
  });
  app.commands.register({
    id: 'archived',
    title: 'Toggle archived threads view',
    run: toggleArchived,
  });
});
