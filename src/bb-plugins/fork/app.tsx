import { useEffect, useSyncExternalStore } from 'react';
import { ThreadChat, definePluginApp, experimental_THREAD_ACTION_GROUPS, useBbNavigate, useSdk, type BbNavigate, type PluginThreadPanelProps } from '@get-bb/plugin-sdk/app';
import { CHOICES, MAX_COUNT, createForker, planForChoice, type ForkPlan, type OpenPanel, type Placement } from './fork.ts';
import { ForkMenu, type MenuSource } from './menu.tsx';
import { mountChatScroll } from './chat-scroll.ts';
import './app.css';

type Repeat = Pick<ForkPlan, 'placement' | 'worktree' | 'count'>;
const repeatKey = 'bb-plugin-fork:last';
const placements = new Set<string>(['switch', 'right', 'left', 'down', 'top', 'sidebar']);

// Model and prompt are per-fork decisions, so the repeat key replays only where and how many.
function readRepeat(): Repeat {
  try {
    const saved = JSON.parse(localStorage.getItem(repeatKey) ?? 'null') as Partial<Repeat> | null;
    if (saved && placements.has(String(saved.placement))) {
      const count = Number.isInteger(saved.count) && saved.count! > 1 && saved.count! <= MAX_COUNT ? saved.count : undefined;
      return { placement: saved.placement as Placement, worktree: saved.worktree === true, ...(count ? { count } : {}) };
    }
  } catch { /* Storage unavailable or corrupt: fall back to the default. */ }
  return { placement: 'switch', worktree: false };
}
function saveRepeat({ placement, worktree, count }: ForkPlan) {
  try { localStorage.setItem(repeatKey, JSON.stringify({ placement, worktree, ...(count ? { count } : {}) })); } catch { /* Not remembered. */ }
}

const panelId = 'fork';
// Commands and thread menus open the panel in the focused thread view, like side chat's replies.
const panelOpener = (navigate: BbNavigate): OpenPanel => fork =>
  navigate.openThreadPanel({ actionId: panelId, title: fork.title ?? 'Fork', params: { threadId: fork.id } });

function ForkPanel({ params }: PluginThreadPanelProps) {
  const threadId = params && typeof params === 'object' && !Array.isArray(params) ? params.threadId : null;
  if (typeof threadId !== 'string') return <p role="alert" className="fork-panel-missing">This fork tab has lost its thread.</p>;
  return <ThreadChat threadId={threadId} variant="compact" layout="contained" permissionPolicy="editable" className="fork-panel" />;
}

export default definePluginApp(app => {
  const forker = createForker();
  app.contentScripts.register({ id: 'chat-scroll', mount: () => mountChatScroll(document) });

  interface Open { source: MenuSource; focus: HTMLElement | null }
  let opened: Open | null = null;
  const menuListeners = new Set<() => void>();
  const setOpened = (next: Open | null) => { opened = next; menuListeners.forEach(listener => listener()); };
  const subscribeMenu = (listener: () => void) => { menuListeners.add(listener); return () => { menuListeners.delete(listener); }; };
  const openMenu = (source: MenuSource) =>
    setOpened({ source, focus: document.activeElement instanceof HTMLElement ? document.activeElement : null });

  const fork = (plan: ForkPlan, openPanel?: OpenPanel) => { saveRepeat(plan); return forker.run(plan, openPanel ? { openPanel } : {}); };

  // Commands and message actions get no SDK client, and BB only logs their errors.
  // This overlay lends them its client, hosts the menu and shows fork progress and failures.
  function Overlay() {
    const sdk = useSdk();
    const navigate = useBbNavigate();
    useEffect(() => forker.attach({ sdk, openPanel: panelOpener(navigate) }), [sdk, navigate]);
    const notice = useSyncExternalStore(forker.subscribe, forker.notice);
    const menu = useSyncExternalStore(subscribeMenu, () => opened);
    useEffect(() => {
      if (notice?.kind !== 'error' && notice?.kind !== 'info') return;
      const timer = setTimeout(forker.dismiss, 6000);
      return () => clearTimeout(timer);
    }, [notice]);
    const copy = (text: string, what: string) => {
      setOpened(null);
      navigator.clipboard.writeText(text).then(
        () => forker.show({ kind: 'info', message: `Copied ${what}.` }),
        cause => forker.show({ kind: 'error', message: `Copy failed: ${cause instanceof Error ? cause.message : String(cause)}` }),
      );
    };
    return <>
      {menu ? <ForkMenu source={menu.source} returnFocus={menu.focus} onClose={() => setOpened(null)} onCopy={copy}
        onRun={plan => { setOpened(null); void fork(plan); }} /> : null}
      {!notice ? null
        : notice.kind === 'busy' ? <p role="status" className="fork-notice">Forking…</p>
        : notice.kind === 'info' ? <p role="status" className="fork-notice">{notice.message}</p>
        : <p role="alert" className="fork-notice fork-notice-error">Fork failed: {notice.message}</p>}
    </>;
  }
  app.slots.experimental_appOverlay({ id: 'notices', component: Overlay });

  app.commands.register({
    id: 'menu',
    title: 'Fork: choose where and how to fork this thread',
    defaultShortcut: { key: 'b', alt: true },
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => { if (threadId) openMenu({ threadId }); },
  });

  app.commands.register({
    id: 'repeat',
    title: 'Fork: fork this thread like last time',
    defaultShortcut: { key: 'B', alt: true, shift: true },
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => threadId ? fork({ sourceThreadId: threadId, ...readRepeat() }) : undefined,
  });

  app.slots.messageAction({
    id: 'fork-here',
    title: 'Fork from here',
    icon: 'Fork',
    run: ({ threadId, message }) => openMenu({ threadId, sourceSeqEnd: message.sourceSeqEnd }),
  });

  // The panel launcher's entry forks the panel's thread into a new tab.
  app.slots.threadPanelAction({
    id: panelId,
    title: 'Fork',
    icon: 'Fork',
    component: ForkPanel,
    layout: 'flush',
    run: context =>
      fork({ sourceThreadId: context.threadId, placement: 'sidebar', worktree: false },
        forked => context.openPanel({ title: forked.title ?? 'Fork', params: { threadId: forked.id } })),
  });

  app.slots.experimental_threadAction({
    id: 'fork',
    title: 'Fork',
    icon: 'Fork',
    group: experimental_THREAD_ACTION_GROUPS.open,
    order: 100,
    item: ({ thread, sdk, navigate }) => ({
      label: 'Fork',
      icon: 'Fork',
      choices: { items: CHOICES },
      run: ({ value }) => {
        const plan = planForChoice(thread.id, value);
        return plan ? forker.run(plan, { sdk, openPanel: panelOpener(navigate) }) : undefined;
      },
    }),
  });
});
