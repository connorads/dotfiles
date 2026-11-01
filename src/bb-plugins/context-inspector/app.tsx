import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { experimental_Icon as Icon, definePluginApp, useComposer, useRpc, useSdk, type PluginBrowserBbSdk } from '@get-bb/plugin-sdk/app';
import { ContextInspectorView, FixtureContextInspector } from './view';
import type { ObservationState, Target } from './observation';
import { rpcContract, type OwnerResult } from './contracts';
import { NativeCosts } from './native-view';
import { mountNativeContextDetails } from './native-popup';
import type { NativeResult } from './native-contract';
import './app.css';

const popupId = 'context';
const composerBindings = new Map<HTMLElement, { threadId: string; open: () => void }>();

/** An invisible anchor binds native meter placement to its actual composer. */
export function NativeContextAnchor() {
  const composer = useComposer();
  const anchor = useRef<HTMLSpanElement>(null);
  const threadId = composer.scope.kind === 'thread' ? composer.scope.threadId : null;
  useEffect(() => {
    const element = anchor.current;
    if (!element || !threadId) return;
    composerBindings.set(element, { threadId, open: () => composer.experimental_openPopup(popupId) });
    return () => { composerBindings.delete(element); };
  }, [composer, threadId]);
  return <span ref={anchor} data-ci-native-anchor="" hidden />;
}

function nativeBinding(trigger: HTMLElement) {
  const shell = trigger.closest('[data-promptbox-shell]');
  if (!shell) return null;
  const matches = [...composerBindings].filter(([anchor]) => shell.contains(anchor));
  if (matches.length !== 1) return null;
  const binding = matches[0][1];
  // The action callback receives a thread ID. Ambiguous duplicate panes stay undecorated.
  return [...composerBindings.values()].filter(value => value.threadId === binding.threadId).length === 1 ? binding : null;
}

export function NativePanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<{ providerId: string | null; tracingEnabled: boolean; report: NativeResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const read = async (collect: boolean) => {
    const id = ++generation.current;
    setLoading(true);
    try {
      const value = await rpc.call('native', { threadId, collect });
      if (id === generation.current) setData(value);
    } catch {
      if (id === generation.current) setData(previous => ({ providerId: previous?.providerId ?? null, tracingEnabled: previous?.tracingEnabled ?? false, report: { kind: 'unavailable', reason: 'Native context read failed.' } }));
    } finally { if (id === generation.current) setLoading(false); }
  };
  useEffect(() => {
    setData(null);
    void read(false);
    return () => { generation.current++; };
  }, [threadId, rpc]);
  async function change(operation: 'tracing' | 'purge', enabled?: boolean) {
    const id = ++generation.current;
    setLoading(true);
    try {
      if (operation === 'tracing') await rpc.call('tracing', { threadId, enabled: enabled === true });
      else {
        const result = await rpc.call('purge', { threadId });
        if (!result.purged) throw new Error('Recorder did not confirm deletion.');
      }
      if (id === generation.current) await read(false);
    } catch {
      if (id === generation.current) setData(previous => ({ providerId: previous?.providerId ?? null, tracingEnabled: previous?.tracingEnabled ?? false, report: { kind: 'unavailable', reason: operation === 'purge' ? 'Trace deletion was refused. Finish queued work and stop the thread recorder first.' : 'Recording preference could not be changed.' } }));
    } finally { if (id === generation.current) setLoading(false); }
  }
  return <NativeCosts report={data?.report ?? null} provider={data?.providerId ?? undefined} tracingEnabled={data?.tracingEnabled}
    loading={loading} onCollect={() => { void read(true); }} onTracingChange={enabled => { void change('tracing', enabled); }} onPurge={() => { void change('purge'); }} />;
}
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
  const popupRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const popup = popupRef.current;
    const host = popup?.closest<HTMLElement>('[data-promptbox-typeahead-menu]');
    if (!popup || !host) return;
    const viewport = window.visualViewport;
    const resize = () => {
      const style = getComputedStyle(host);
      const height = viewport?.height ?? window.innerHeight;
      const available = style.position === 'absolute' && style.bottom !== 'auto'
        ? host.getBoundingClientRect().bottom - (viewport?.offsetTop ?? 0) - 12 : height * .76;
      popup.style.setProperty('--ci-max-height', `${Math.max(0, Math.min(height * .76, available))}px`);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener('resize', resize);
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    resize();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
    };
  }, []);
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
      const [context, owner, settings, inventory, identities] = await Promise.allSettled([
        sdk.threads.context({ threadId: thread.id, signal: abort.signal }),
        rpc.call('owner', { threadId: thread.id }),
        sdk.plugins.getSettings({ pluginId: 'bb-guide', signal: abort.signal }),
        sdk.plugins.list({ signal: abort.signal }).then(inventoryRows),
        sdk.threads.events.list({ threadId: thread.id, types: ['thread/identity', 'thread/context/cleared'], order: 'desc', limit: '1', signal: abort.signal }),
      ]);
      if (!active) return;
      const identity = identities.status === 'fulfilled' ? identities.value[0] : undefined;
      if (identity?.type === 'thread/identity') target.providerSessionId = identity.data.providerThreadId;
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
  return <div className="ci-popup" ref={popupRef}>
    {!data && <header className="ci-loading-header"><strong>Context inspector</strong><span className="ci-spacer" />{controls}</header>}
    {!threadId ? <p>Select an existing thread.</p> : current?.error ? <p role="alert">{current.error}</p> : !data ? <p role="status">Loading selected thread.</p> : <>
      <ContextInspectorView target={data.target} state={data.state} ownerText={data.owner.kind === 'available' ? data.owner.text : ''}
        ownerUnavailable={data.owner.kind === 'unavailable' ? data.owner.reason : data.settings.error}
        savedIntroduction={data.settings.value} onExportPatch={exportPatch} inventory={data.inventory} inventoryError={data.inventoryError}
        controls={controls} native={<NativePanel key={data.target.threadId} threadId={data.target.threadId} />} />
    </>}
  </div>;
}

export default definePluginApp(app => {
  app.composer.customize({ id: 'inspector', scopes: ['thread'],
    actions: [{ id: 'native-context-anchor', component: NativeContextAnchor }],
    experimental_popups: [{ id: popupId, label: 'Context inspector', component: InspectorPopup }],
    plusMenu: [{ id: 'open', label: 'Inspect context', run: ({ composer }) => { composer.experimental_openPopup(popupId); } }],
  });
  app.contentScripts.register({ id: 'native-context-details', mount: () => mountNativeContextDetails({ document,
    resolveThread: trigger => nativeBinding(trigger)?.threadId ?? null,
    onInspect: threadId => {
      const matches = [...composerBindings.values()].filter(value => value.threadId === threadId);
      if (matches.length === 1) matches[0].open();
    },
  }) });
  app.slots.navPanel({ id: 'fixtures', title: 'Context inspector fixtures', icon: 'Search', path: 'fixtures', component: FixtureContextInspector });
});
