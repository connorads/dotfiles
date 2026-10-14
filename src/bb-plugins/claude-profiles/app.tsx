import { definePluginApp } from '@get-bb/plugin-sdk/app';
import { AccountStatus, isClaude, openAccount } from './ui/account-status.tsx';
import { AccountOverlay } from './ui/account-overlay.tsx';
import { ThreadUsage } from './ui/usage/badge.tsx';
import { UsageOverlay } from './ui/usage/overlay.tsx';
import { openUsage } from './ui/usage/overlay-store.ts';

export default definePluginApp(app => {
  app.composer.customize({
    id: 'claude-account', scopes: ['thread', 'new-thread'],
    actions: [{ id: 'claude-account', component: AccountStatus }],
  });
  app.composer.experimental_registerCommand({ id: 'open-switcher', title: 'Switch Claude account',
    defaultShortcut: { key: 'a', alt: true },
    run: ({ composer }) => { if (isClaude(composer)) openAccount(composer); } });
  app.slots.experimental_appOverlay({ id: 'picker', component: AccountOverlay });
  app.slots.experimental_threadHeaderAction({ id: 'usage', title: 'Usage', component: ThreadUsage });
  app.slots.experimental_appOverlay({ id: 'usage-overview', component: UsageOverlay });
  app.commands.register({ id: 'show-usage', title: 'Show agent usage', defaultShortcut: { key: 'a', mod: true, shift: true }, run: openUsage });
});
