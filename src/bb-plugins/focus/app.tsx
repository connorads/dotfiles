import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  definePluginApp, useRealtime, useRpc,
  type ExperimentalSidebarFooterDisclosureProps, type PluginRpcClient,
} from '@get-bb/plugin-sdk/app';
import type { FocusView, rpcContract } from './contracts.ts';
import './app.css';

// One module store: commands run outside React, and the footer panel mounts
// only while open. The overlay keeps the rpc client and the view current.
type Rpc = PluginRpcClient<typeof rpcContract>;
let client: Rpc | null = null;
let view: FocusView | null = null;
const listeners = new Set<() => void>();
const receive = (next: unknown) => { view = next as FocusView; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const useView = () => useSyncExternalStore(subscribe, () => view);
function rpc(): Rpc {
  if (!client) throw new Error('Focus is still loading.');
  return client;
}
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

function Connection() {
  client = useRpc<typeof rpcContract>();
  useRealtime('state', receive);
  useEffect(() => { client?.call('view', {}).then(receive, () => {}); }, []);
  return null;
}

function Panel(props: ExperimentalSidebarFooterDisclosureProps) {
  const current = useView();
  const [error, setError] = useState<string | null>(null);
  const run = (call: () => Promise<FocusView>) => call().then(next => { receive(next); setError(null); }, cause => setError(message(cause)));
  useEffect(() => { void run(() => rpc().call('view', {})); }, []);

  if (!current) return <div className="fx-panel"><p className="fx-note">{error ?? 'Loading…'}</p></div>;
  return <div className="fx-panel" onKeyDown={event => { if (event.key === 'Escape') props.dismiss(); }}>
    <div className="fx-head">
      <span className="fx-title">{current.active ? 'Focus view on' : 'Focus view off'}</span>
      <button type="button" className="fx-button" aria-pressed={current.active}
        onClick={() => run(() => rpc().call('toggle', { projectId: null }))}>
        {current.active ? 'Turn off' : 'Turn on'}
      </button>
    </div>
    {error && <p className="fx-note">{error}</p>}
    <ul className="fx-list">
      {current.projects.map(project => {
        const shown = project.always || project.member;
        return <li key={project.id} className="fx-row" data-shown={current.active && shown ? '' : undefined}>
          <label className="fx-pick">
            <input type="checkbox" checked={shown} disabled={project.always}
              onChange={event => run(() => rpc().call('setMember', { projectId: project.id, included: event.target.checked }))} />
            <span className="fx-name">{project.name}</span>
          </label>
          <button type="button" className="fx-pin" aria-pressed={project.always}
            title={project.always ? 'Always shown. Click to stop.' : 'Always show in focus views'}
            onClick={() => run(() => rpc().call('setAlwaysShow', { projectId: project.id, on: !project.always }))}>
            {project.always ? 'always' : 'pin'}
          </button>
        </li>;
      })}
    </ul>
  </div>;
}

const report = (cause: unknown) => console.error(`focus: ${message(cause)}`);

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'connection', component: Connection });
  const panel = app.experimental_sidebarFooter.register({ kind: 'disclosure', id: 'focus', label: 'Focus view', icon: 'EyeOff', component: Panel });
  app.commands.register({
    id: 'toggle', title: 'Focus: turn the focus view on or off',
    defaultShortcut: { key: 'f', mod: true, shift: true },
    run: ({ projectId }) => rpc().call('toggle', { projectId }).then(receive, report),
  });
  app.commands.register({
    id: 'add', title: 'Focus: add this project to the focus view',
    isAvailable: ({ projectId }) => projectId !== null,
    run: ({ projectId }) => { if (projectId) return rpc().call('setMember', { projectId, included: true }).then(receive, report); },
  });
  app.commands.register({
    id: 'always', title: 'Focus: always show this project (toggle)',
    isAvailable: ({ projectId }) => projectId !== null,
    run: ({ projectId }) => {
      if (!projectId) return;
      const always = view?.projects.find(project => project.id === projectId)?.always ?? false;
      return rpc().call('setAlwaysShow', { projectId, on: !always }).then(receive, report);
    },
  });
  app.commands.register({ id: 'choose', title: 'Focus: choose projects', run: () => panel.toggle() });
});
