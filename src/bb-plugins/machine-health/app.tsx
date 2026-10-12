import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { definePluginApp, useRpc } from '@get-bb/plugin-sdk/app';
import type { ExperimentalSidebarFooterDisclosureProps, PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract } from './contracts.ts';
import { MachineDialog, Rows, type Anchor } from './dialog.tsx';
import { chip, type Chip as ChipView, type LabelMode, type Tone } from './src/present.ts';
import { MetricIcon } from './icons.tsx';
import type { ChipTone } from '@bb-plugins/chip';
import '@bb-plugins/chip';
import './app.css';

/** The server shares one sample per machine across every chip, window and split pane. */
const pollMs = 10_000;
const chipTone: Record<Tone, ChipTone | undefined> = { ok: undefined, off: undefined, warn: 'warn', critical: 'danger' };
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

// Window-local store: the label mode (prefix + H in tmux) and the open dialog.
const labelKey = 'bb-plugin-machine-health:label';
type Open = { threadId: string; anchor: Anchor } | null;
let labelMode: LabelMode = localStorage.getItem(labelKey) === 'full' ? 'full' : 'short';
let opened: Open = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const emit = () => listeners.forEach(listener => listener());
const useLabelMode = () => useSyncExternalStore(subscribe, () => labelMode);
function toggleLabel() {
  labelMode = labelMode === 'full' ? 'short' : 'full';
  localStorage.setItem(labelKey, labelMode);
  emit();
}
const chipEl = (threadId: string) => document.querySelector<HTMLElement>(`[data-machine-health="${CSS.escape(threadId)}"]`);
function toggle(threadId: string) {
  if (opened?.threadId === threadId) { opened = null; emit(); return; }
  const box = chipEl(threadId)?.getBoundingClientRect();
  opened = { threadId, anchor: box ? { right: box.right, bottom: box.bottom } : null };
  emit();
}
function close() {
  const threadId = opened?.threadId;
  opened = null;
  emit();
  if (threadId) chipEl(threadId)?.focus({ preventScroll: true });
}

/**
 * Poll while the window is visible; resync on return to visible. Only the
 * latest request may set state, so a slow reply for the pane's previous
 * thread cannot overwrite the current one.
 */
function usePolled<T>(read: () => Promise<T>) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const refresh = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    const request = ++latest.current;
    read().then(
      next => { if (request === latest.current) { setValue(next); setError(null); } },
      cause => { if (request === latest.current) setError(message(cause)); });
  }, [read]);
  useEffect(() => {
    setValue(null);
    setError(null);
    refresh();
    const timer = setInterval(refresh, pollMs);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [refresh]);
  return { value, error, refresh };
}

function useThreadMachine(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const read = useCallback(async () => (await rpc.call('thread', { threadId })).machine, [rpc, threadId]);
  return usePolled(read);
}

/** The machine label only when it adds something: a remote machine, or the footer's list. */
function Pills({ view, withLabel }: { view: ChipView; withLabel: boolean }) {
  return <>
    {withLabel && <span className="mh-label">{view.remote && <span aria-label="remote" title="Remote machine">⇄ </span>}{view.label}</span>}
    {view.segments.map(segment => <span key={segment.key} className="mh-metric" data-tone={segment.tone} title={segment.title}>
      <MetricIcon metric={segment.key} />{segment.value}
    </span>)}
  </>;
}

function Chip({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { value: machine } = useThreadMachine(threadId);
  const mode = useLabelMode();
  const isOpen = useSyncExternalStore(subscribe, () => opened?.threadId === threadId);
  if (!machine) return null;
  const view = chip(machine, isCompactViewport, mode);
  return <button type="button" className="bbp-chip mh-chip" data-machine-health={threadId} data-tone={chipTone[view.tone]}
    aria-expanded={isOpen} aria-haspopup="dialog" aria-label={view.summary} title={`${view.summary} (⌥H)`}
    onClick={() => toggle(threadId)}>
    <Pills view={view} withLabel={view.remote} />
  </button>;
}

function LabelButton() {
  const mode = useLabelMode();
  return <button type="button" onClick={toggleLabel}>{mode === 'full' ? 'Short name' : 'Full hostname'}</button>;
}

function Dialog({ threadId, anchor }: NonNullable<Open>) {
  const { value: machine, error, refresh } = useThreadMachine(threadId);
  return <MachineDialog threadId={threadId} anchor={anchor} machine={machine} machineError={error}
    onRefreshMachine={refresh} labelButton={<LabelButton />} onClose={close} />;
}

function Overlay() {
  const current = useSyncExternalStore(subscribe, () => opened);
  return current ? <Dialog key={current.threadId} {...current} /> : null;
}

/** Every machine at once: the view tmux could not give, since each status bar saw only its own host. */
function Machines(_props: ExperimentalSidebarFooterDisclosureProps) {
  const rpc = useRpc<typeof rpcContract>();
  const read = useCallback(async () => (await rpc.call('machines', {})).machines, [rpc]);
  const { value: machines, error } = usePolled(read);
  const mode = useLabelMode();
  const [expanded, setExpanded] = useState<string | null>(null);
  return <div className="mh-machines">
    {!machines && !error && <p className="mh-empty">Sampling machines…</p>}
    {error && <p role="alert" className="mh-error">{error}</p>}
    {machines?.map(machine => {
      const view = chip(machine, false, mode);
      return <div key={machine.hostId} className="mh-machine">
        <button type="button" className="mh-machine-row" data-tone={view.tone} aria-label={view.summary}
          aria-expanded={expanded === machine.hostId} onClick={() => setExpanded(expanded === machine.hostId ? null : machine.hostId)}>
          <Pills view={view} withLabel />
        </button>
        {expanded === machine.hostId && <Rows machine={machine} />}
      </div>;
    })}
  </div>;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'dialog', component: Overlay });
  app.slots.experimental_threadHeaderAction({ id: 'chip', title: 'Machine health', component: Chip });
  app.experimental_sidebarFooter.register({ kind: 'disclosure', id: 'machines', label: 'Machines', icon: 'Laptop', component: Machines });
  app.commands.register({
    id: 'toggle', title: 'Machine health: Toggle dialog', defaultShortcut: { key: 'h', alt: true },
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => { if (threadId) toggle(threadId); },
  });
  // No default: Alt+Shift+H is BB's previous-thread binding on macOS.
  app.commands.register({ id: 'toggle-hostname', title: 'Machine health: Toggle full hostname', run: toggleLabel });
});
