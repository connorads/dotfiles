import { useEffect, useState } from 'react';
import { experimental_Icon as Icon, definePluginApp, useComposer, useRpc, useSdk, type PluginBrowserBbSdk } from '@get-bb/plugin-sdk/app';
import { ContextInspectorView, FixtureContextInspector } from './view';
import type { ObservationState, Target } from './observation';
import { rpcContract, type OwnerResult } from './contracts';
import './app.css';

const popupId = 'context';
type InventoryRow = { pluginId: string; enabled: boolean; kind: string; id: string; label: string };
type Inventory = { rows: InventoryRow[]; truncated: boolean };
type Settings = { value?: boolean; error?: string };
type Data = { target: Target; state: ObservationState; owner: OwnerResult; settings: Settings; inventory: Inventory | null; inventoryError?: string };

/** Metadata only. Never retain capability bodies, descriptions or setting dumps. */
export function inventoryRows(plugins: Awaited<ReturnType<PluginBrowserBbSdk['plugins']['list']>>): Inventory {
  const rows: InventoryRow[] = [];
  let count = 0;
  for (const plugin of plugins.plugins) for (const capability of plugin.capabilities) {
    if (capability.kind !== 'agent-tool' && capability.kind !== 'skill') continue;
    count++;
    if (rows.length < 200) rows.push({ pluginId: plugin.id.slice(0, 160), enabled: plugin.enabled,
      kind: capability.kind, id: capability.id.slice(0, 160), label: capability.label.slice(0, 160) });
  }
  return { rows, truncated: count > rows.length };
}

function exportPatch(patch: string) {
  const url = URL.createObjectURL(new Blob([patch], { type: 'text/x-diff;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'context-inspector-private.patch'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function InspectorPopup() {
  const composer = useComposer();
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const threadId = composer.scope.kind === 'thread' ? composer.scope.threadId : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ threadId: string; revision: number; data?: Data; error?: string } | null>(null);
  useEffect(() => {
    if (!threadId) return;
    const selectedThreadId = threadId;
    const abort = new AbortController();
    let active = true;
    async function read() {
      const thread = await sdk.threads.get({ threadId: selectedThreadId, signal: abort.signal });
      const environment = thread.environmentId ? await sdk.environments.get({ environmentId: thread.environmentId, signal: abort.signal }) : null;
      const target: Target = { threadId: thread.id, hostId: environment?.hostId ?? 'Unknown' };
      const [context, owner, settings, inventory] = await Promise.allSettled([
        sdk.threads.context({ threadId: thread.id, signal: abort.signal }),
        rpc.call('owner', { threadId: thread.id }),
        sdk.plugins.getSettings({ pluginId: 'bb-guide', signal: abort.signal }),
        sdk.plugins.list({ signal: abort.signal }).then(inventoryRows),
      ]);
      if (!active) return;
      let saved: Settings = { error: 'BB Guide introduction schema is unavailable.' };
      if (settings.status === 'fulfilled' && settings.value.schema.introduction?.type === 'boolean') {
        const value = settings.value.values.introduction;
        saved = typeof value === 'boolean' ? { value } : { error: 'Saved introduction value is unavailable.' };
      }
      setResult({ threadId: thread.id, revision, data: {
        target,
        state: context.status === 'fulfilled' ? { kind: 'recorded', observation: { target, receivedAt: new Date().toISOString(), context: context.value } } : { kind: 'unavailable', reason: 'Recorded context read failed.' },
        owner: owner.status === 'fulfilled' ? owner.value : { kind: 'unavailable', reason: 'Owner read failed.' },
        settings: saved,
        inventory: inventory.status === 'fulfilled' ? inventory.value : null,
        ...(inventory.status === 'rejected' ? { inventoryError: 'Current inventory read failed.' } : {}),
      } });
    }
    void read().catch(() => { if (active) setResult({ threadId, revision, error: 'Selected thread read failed.' }); });
    return () => { active = false; abort.abort(); };
  }, [threadId, sdk, rpc, revision]);
  const current = result?.threadId === threadId && result.revision === revision ? result : null;
  const data = current?.data;
  const controls = <><button className="ci-icon-button" type="button" aria-label="Refresh recorded data" title="Refresh recorded data" onClick={() => setRevision(value => value + 1)}><Icon name="RefreshCw" /></button><button className="ci-icon-button" type="button" aria-label="Close" title="Close" onClick={() => composer.experimental_closePopup()}><Icon name="X" /></button></>;
  return <div className="ci-popup">
    {!data && <header className="ci-loading-header"><strong>Context inspector</strong><span className="ci-spacer" />{controls}</header>}
    {!threadId ? <p>Select an existing thread.</p> : current?.error ? <p role="alert">{current.error}</p> : !data ? <p role="status">Loading selected thread.</p> : <>
      <ContextInspectorView target={data.target} state={data.state} ownerText={data.owner.kind === 'available' ? data.owner.text : ''}
        ownerUnavailable={data.owner.kind === 'unavailable' ? data.owner.reason : data.settings.error}
        savedIntroduction={data.settings.value} onExportPatch={exportPatch} inventory={data.inventory} inventoryError={data.inventoryError}
        controls={controls} />
    </>}
  </div>;
}

function ContextAction() {
  const composer = useComposer();
  return <button type="button" onClick={() => composer.experimental_openPopup(popupId)}>Context</button>;
}
export default definePluginApp(app => {
  app.composer.customize({ id: 'inspector', scopes: ['thread'], actions: [{ id: 'open', component: ContextAction }],
    experimental_popups: [{ id: popupId, label: 'Context inspector', component: InspectorPopup }],
    plusMenu: [{ id: 'open', label: 'Inspect context', run: ({ composer }) => { composer.experimental_openPopup(popupId); } }],
  });
  app.slots.navPanel({ id: 'fixtures', title: 'Context inspector fixtures', icon: 'Search', path: 'fixtures', component: FixtureContextInspector });
});
