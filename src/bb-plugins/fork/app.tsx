import { useEffect, useSyncExternalStore } from 'react';
import { definePluginApp, experimental_THREAD_ACTION_GROUPS, useSdk } from '@get-bb/plugin-sdk/app';
import { CHOICES, createForker, planForChoice } from './fork.ts';
import { mountChatScroll } from './chat-scroll.ts';
import './app.css';

export default definePluginApp(app => {
  const forker = createForker();
  app.contentScripts.register({ id: 'chat-scroll', mount: () => mountChatScroll(document) });

  // Commands and message actions get no SDK client, and BB only logs their errors.
  // This overlay lends them its client and shows fork progress and failures.
  function Notices() {
    const sdk = useSdk();
    useEffect(() => forker.attach(sdk), [sdk]);
    const notice = useSyncExternalStore(forker.subscribe, forker.notice);
    useEffect(() => {
      if (notice?.kind !== 'error') return;
      const timer = setTimeout(forker.dismiss, 6000);
      return () => clearTimeout(timer);
    }, [notice]);
    if (!notice) return null;
    return notice.kind === 'busy'
      ? <p role="status" className="fork-notice">Forking…</p>
      : <p role="alert" className="fork-notice fork-notice-error">Fork failed: {notice.message}</p>;
  }
  app.slots.experimental_appOverlay({ id: 'notices', component: Notices });

  app.commands.register({
    id: 'split',
    title: 'Fork: fork this thread into a split on the right',
    defaultShortcut: { key: 'b', alt: true },
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => threadId ? forker.run({ sourceThreadId: threadId, placement: 'right', worktree: false }) : undefined,
  });

  app.slots.messageAction({
    id: 'fork-here',
    title: 'Fork from here',
    icon: 'Fork',
    run: ({ threadId, message }) =>
      forker.run({ sourceThreadId: threadId, sourceSeqEnd: message.sourceSeqEnd, placement: 'right', worktree: false }),
  });

  app.slots.experimental_threadAction({
    id: 'fork',
    title: 'Fork',
    icon: 'Fork',
    group: experimental_THREAD_ACTION_GROUPS.open,
    order: 100,
    item: ({ thread, sdk }) => ({
      label: 'Fork',
      icon: 'Fork',
      choices: { items: CHOICES },
      run: ({ value }) => {
        const plan = planForChoice(thread.id, value);
        return plan ? forker.run(plan, sdk) : undefined;
      },
    }),
  });
});
