import { useEffect, useRef, useSyncExternalStore } from 'react';
import { definePluginApp, experimental_Icon as Icon, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract } from './contracts.ts';
import { GitPopover, type Anchor } from './popover.tsx';
import { receiveOp, receiveSnapshot, renewAll, useRepo } from './repo-store.ts';
import './app.css';

type Open = { threadId: string; anchor: Anchor; instant: boolean } | null;
let opened: Open = null;
const listeners = new Set<() => void>();
function show(next: Open) { opened = next; listeners.forEach(listener => listener()); }
const chip = (threadId: string) => document.querySelector<HTMLElement>(`[data-git-glance="${CSS.escape(threadId)}"]`);
/** Keyboard opens skip the entrance: a shortcut used all day must feel instant. */
function toggle(threadId: string, via: 'pointer' | 'keyboard') {
  if (opened?.threadId === threadId) { show(null); return; }
  const box = chip(threadId)?.getBoundingClientRect();
  show({ threadId, anchor: box ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left } : null, instant: via === 'keyboard' });
}
function close() {
  const threadId = opened?.threadId;
  show(null);
  if (threadId) chip(threadId)?.focus({ preventScroll: true });
}

function Overlay() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => opened);
  useRealtime('snapshot', receiveSnapshot);
  useRealtime('op', receiveOp);
  // Realtime messages are not replayed, so resynchronise after a reconnect.
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (connection === 'connected' && previous.current !== 'connected') renewAll();
    previous.current = connection;
  }, [connection]);
  return current ? <GitPopover key={current.threadId} threadId={current.threadId} anchor={current.anchor} instant={current.instant} onClose={close} /> : null;
}

function Chip({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const { snapshot: data, op, error } = useRepo(threadId, rpc);
  const isOpen = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => opened?.threadId === threadId);
  if (!data && !error) return null;
  if (data?.kind === 'none') return null;
  const files = data ? new Set(data.changes.map(c => c.path)).size + data.hidden : 0;
  const danger = data && (data.operation || data.changes.some(c => c.area === 'conflicted'));
  const branch = data ? data.branch.head ?? data.branch.oid?.slice(0, 7) ?? 'unborn' : 'git';
  const label = data
    ? [`Git: ${branch}`, data.branch.ahead && `${data.branch.ahead} to push`, data.branch.behind && `${data.branch.behind} to pull`,
      files ? `${files} changed` : 'clean'].filter(Boolean).join(', ')
    : `Git status unavailable: ${error}`;
  return <button type="button" className="gg-chip" data-git-glance={threadId} aria-expanded={isOpen} aria-haspopup="dialog"
    data-tone={error ? 'error' : danger ? 'danger' : files ? 'dirty' : 'clean'} aria-label={label} title={`${label} (⌥G)`}
    onClick={event => toggle(threadId, event.detail === 0 ? 'keyboard' : 'pointer')}>
    {op?.status === 'running' ? <span className="gg-spinner gg-spinner-sm" aria-hidden />
      : <Icon name={data?.operation ? 'AlertTriangle' : 'GitBranch'} className="gg-chip-icon" />}
    {!isCompactViewport && <span className="gg-chip-branch">{data?.operation ? data.operation : branch}</span>}
    {data && data.branch.ahead > 0 && !isCompactViewport && <span className="gg-chip-ahead">↑{data.branch.ahead}</span>}
    {data && data.branch.behind > 0 && !isCompactViewport && <span className="gg-chip-behind">↓{data.branch.behind}</span>}
    {files > 0 && <span className="gg-chip-dirty"><i />{files}</span>}
  </button>;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'popover', component: Overlay });
  app.slots.experimental_threadHeaderAction({ id: 'status', title: 'Git status', component: Chip });
  app.commands.register({
    id: 'toggle', title: 'Git: Toggle repository status', defaultShortcut: { key: 'g', alt: true },
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => { if (threadId) toggle(threadId, 'keyboard'); },
  });
});
