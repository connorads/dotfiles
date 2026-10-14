import { useEffect, useRef, useSyncExternalStore } from 'react';
import { definePluginApp, experimental_Icon as Icon, useComposer, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import { Chip as GlanceChip, ChipDot, ChipValue } from '@bb-plugins/chip';
import { projectSubject, subjectProject, type rpcContract } from './contracts.ts';
import { chip, GitPopover, type Anchor } from './popover.tsx';
import { receiveOp, receiveSnapshot, renew, renewAll, useRepo } from './repo-store.ts';
import './app.css';

type Open = { threadId: string; anchor: Anchor; instant: boolean } | null;
let opened: Open = null;
const listeners = new Set<() => void>();
function show(next: Open) { opened = next; listeners.forEach(listener => listener()); }
/** Keyboard opens skip the entrance: a shortcut used all day must feel instant. */
function toggle(threadId: string, via: 'pointer' | 'keyboard') {
  if (opened?.threadId === threadId) { show(null); return; }
  const box = chip(threadId)?.getBoundingClientRect();
  show({ threadId, anchor: box ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left } : null, instant: via === 'keyboard' });
}
function close() { show(null); }

function Overlay() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => opened);
  useRealtime('snapshot', receiveSnapshot);
  useRealtime('op', receiveOp);
  useRealtime('repository', payload => { void renew((payload as { threadId: string }).threadId); });
  // Realtime messages are not replayed, so resynchronise after a reconnect.
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (connection === 'connected' && previous.current !== 'connected') renewAll();
    previous.current = connection;
  }, [connection]);
  return current ? <GitPopover key={current.threadId} threadId={current.threadId} anchor={current.anchor} instant={current.instant} onClose={close} /> : null;
}

function Chip({ threadId, isCompactViewport }: Pick<PluginThreadHeaderActionProps, 'threadId' | 'isCompactViewport'>) {
  const rpc = useRpc<typeof rpcContract>();
  const { root, snapshot: data, op, error } = useRepo(threadId, rpc);
  const isOpen = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => opened?.threadId === threadId);
  if (!data && !error) return null;
  // A project with no checkout, such as "Don't work in a project", has nothing to choose from.
  if (root === null && subjectProject(threadId) !== null && !error) return null;
  const repo = data?.kind === 'none' ? null : data;
  const files = repo ? new Set(repo.changes.map(c => c.path)).size + repo.hidden : 0;
  const danger = repo && (repo.operation || repo.changes.some(c => c.area === 'conflicted'));
  const branch = repo ? repo.branch.head ?? repo.branch.oid?.slice(0, 7) ?? 'unborn' : 'Choose repo';
  const label = repo
    ? [`Git: ${branch}`, repo.branch.ahead && `${repo.branch.ahead} to push`, repo.branch.behind && `${repo.branch.behind} to pull`,
      files ? `${files} changed` : 'clean'].filter(Boolean).join(', ')
    : error ? `Git status unavailable: ${error}` : 'Choose a Git repository';
  return <GlanceChip data-git-glance={threadId} expanded={isOpen} tone={error ? 'warn' : danger ? 'danger' : undefined}
    aria-label={label} title={`${label} (⌥G)`} onClick={event => toggle(threadId, event.detail === 0 ? 'keyboard' : 'pointer')}
    icon={op?.status === 'running' ? <span className="gg-spinner gg-spinner-sm" />
      : <Icon name={repo?.operation || error ? 'AlertTriangle' : 'GitBranch'} />}>
    {!isCompactViewport && <ChipValue className="gg-chip-branch">{repo?.operation ? repo.operation : branch}</ChipValue>}
    {repo && repo.branch.ahead > 0 && !isCompactViewport && <span className="gg-chip-ahead">↑{repo.branch.ahead}</span>}
    {repo && repo.branch.behind > 0 && !isCompactViewport && <span className="gg-chip-behind">↓{repo.branch.behind}</span>}
    {files > 0 && <ChipDot tone="warn">{files}</ChipDot>}
  </GlanceChip>;
}

/** The New thread composer's picked project, which Alt+G opens when no thread is in view. */
let composerSubject: string | null = null;

function ComposerChip() {
  const { scope } = useComposer();
  const subject = scope.kind === 'new-thread' && scope.projectId !== null ? projectSubject(scope.projectId) : null;
  useEffect(() => {
    composerSubject = subject;
    return () => { if (composerSubject === subject) composerSubject = null; };
  }, [subject]);
  return subject ? <Chip threadId={subject} isCompactViewport={false} /> : null;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'popover', component: Overlay });
  app.slots.experimental_threadHeaderAction({ id: 'status', title: 'Git status', component: Chip });
  app.composer.customize({ id: 'status', scopes: ['new-thread'], actions: [{ id: 'status', component: ComposerChip }] });
  app.commands.register({
    id: 'toggle', title: 'Toggle git status', defaultShortcut: { key: 'g', alt: true },
    isAvailable: ({ threadId }) => (threadId ?? composerSubject) !== null,
    run: ({ threadId }) => {
      const subject = threadId ?? composerSubject;
      if (subject) toggle(subject, 'keyboard');
    },
  });
});
