import { useEffect, useSyncExternalStore } from 'react';
import { definePluginApp, useRealtime, useRpc, type PluginRpcClient } from '@get-bb/plugin-sdk/app';
import { viewSchema, type FocusView, type rpcContract } from './contracts.ts';
import { mountChrome } from './src/footer.ts';
import { Switcher, type SwitcherActions } from './src/switcher.tsx';
import './app.css';

// One module store: commands run outside React.
type Rpc = PluginRpcClient<typeof rpcContract>;
let client: Rpc | null = null;
let view: FocusView | null = null;
let open = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const receive = (next: unknown) => { view = viewSchema.parse(next); notify(); };
const setOpen = (next: boolean) => { open = next; notify(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function rpc(): Rpc {
  if (!client) throw new Error('Focus is still loading.');
  return client;
}
const report = (cause: unknown) => console.error(`focus: ${cause instanceof Error ? cause.message : String(cause)}`);
const load = (call: Promise<FocusView>) => call.then(next => { receive(next); return next; });

const actions: SwitcherActions = {
  activate: setId => load(rpc().call('activate', { setId })),
  create: () => load(rpc().call('createSet', { name: 'New set' })),
  rename: (setId, name) => load(rpc().call('renameSet', { setId, name })),
  remove: setId => load(rpc().call('deleteSet', { setId })),
  setProject: (setId, projectId, included) => load(rpc().call('setProject', { setId, projectId, included })),
  setMask: (setId, mask) => load(rpc().call('setMask', { setId, mask })),
  close: () => setOpen(false),
};

/** The first press opens the switcher. A second press swaps between Off and the last set. */
function press() {
  if (!open) { setOpen(true); return; }
  setOpen(false);
  void load(rpc().call('swap', {})).catch(report);
}

function Overlay() {
  client = useRpc<typeof rpcContract>();
  useRealtime('state', receive);
  useEffect(() => { client?.call('view', {}).then(receive, report); }, []);
  const current = useSyncExternalStore(subscribe, () => view);
  const isOpen = useSyncExternalStore(subscribe, () => open);
  return isOpen && current ? <Switcher view={current} actions={actions} /> : null;
}

const activeSet = () => view?.sets.find(set => set.id === view?.activeSetId) ?? null;

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'switcher', component: Overlay });
  app.experimental_sidebarFooter.register({ kind: 'action', id: 'focus', label: 'Focus sets', icon: 'EyeOff', onActivate: () => setOpen(true) });
  app.contentScripts.register({ id: 'focus-chrome', mount: () => mountChrome(document, {
    active: () => activeSet() !== null,
    mask: () => { const mask = activeSet()?.mask; return mask && mask !== 'off' ? mask : null; },
    subscribe,
  }) });
  app.commands.register({
    id: 'open', title: 'Focus: switch set',
    defaultShortcut: { key: 'f', mod: true, shift: true },
    run: press,
  });
  app.commands.register({
    id: 'add', title: 'Focus: add this project to the running set',
    isAvailable: ({ projectId }) => projectId !== null && activeSet() !== null,
    run: ({ projectId }) => {
      const set = activeSet();
      if (projectId && set) void actions.setProject(set.id, projectId, true).catch(report);
    },
  });
});
