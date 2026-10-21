import { definePluginApp } from '@get-bb/plugin-sdk/app';
import { AccountStatus, isClaude, openAccount } from './ui/account-status.tsx';
import { command, CommandOwner, Overlay } from './ui/picker/picker.tsx';
import { Trigger } from './ui/picker/trigger.tsx';
import { open as openPicker } from './ui/picker/store.ts';
import { ThreadUsage } from './ui/usage/badge.tsx';
import { UsageOverlay } from './ui/usage/overlay.tsx';
import { openUsage } from './ui/usage/overlay-store.ts';
import { LoginPage } from './ui/usage/login.tsx';
import { BadgeBridge } from './ui/badges/bridge.tsx';
import { mountAccountBadges } from './ui/badges/rows.ts';
import { mountWorkflowAccounts } from './ui/badges/workflows.ts';
import './ui/badges/badges.css';

export default definePluginApp(app => {
  app.slots.navPanel({ id: 'claude-login', title: 'Agent sign-in', icon: 'SquareTerminal', path: 'claude-login', component: LoginPage });
  app.composer.customize({
    id: 'claude-account', scopes: ['thread', 'new-thread'],
    actions: [{ id: 'claude-account', component: AccountStatus }],
  });
  app.composer.experimental_registerCommand({ id: 'open-switcher', title: 'Switch Claude account',
    defaultShortcut: { key: 'a', alt: true },
    run: ({ composer }) => { if (isClaude(composer)) openAccount(composer); } });
  app.slots.experimental_appOverlay({ id: 'picker', component: Overlay });
  app.composer.customize({ id: 'agent-switcher', scopes: ['thread', 'new-thread'],
    banners: [{ id: 'command-owner', chrome: 'bare', component: CommandOwner }],
    actions: [{ id: 'picker', component: Trigger }],
    plusMenu: [{ id: 'picker', label: 'Switch model', icon: 'Star', run: ({ composer }) => openPicker(composer) }],
  });
  app.composer.experimental_registerCommand({ id: 'open-picker', title: 'Open model picker',
    defaultShortcut: { key: 'f', alt: true }, run: ({ composer }) => openPicker(composer) });
  app.composer.experimental_registerCommand({ id: 'next-favourite', title: 'Next favourite model',
    defaultShortcut: { key: 'f', alt: true, shift: true }, run: ({ composer }) => command(composer, controller => controller.cycle(1)) });
  app.composer.experimental_registerCommand({ id: 'previous-favourite', title: 'Previous favourite model',
    run: ({ composer }) => command(composer, controller => controller.cycle(-1)) });
  for (let slot = 1; slot <= 9; slot++) app.composer.experimental_registerCommand({ id: `select-favourite-${slot}`,
    title: `Select favourite model ${slot}`, run: ({ composer }) => command(composer, controller => controller.select(slot)) });
  app.slots.experimental_threadHeaderAction({ id: 'usage', title: 'Usage', component: ThreadUsage });
  app.slots.experimental_appOverlay({ id: 'usage-overview', component: UsageOverlay });
  app.slots.experimental_appOverlay({ id: 'account-badges', component: BadgeBridge });
  app.contentScripts.register({ id: 'workflow-accounts', mount: () => mountWorkflowAccounts(document) });
  app.contentScripts.register({ id: 'account-badges', mount: () => mountAccountBadges(document) });
  app.commands.register({ id: 'show-usage', title: 'Show agent usage', defaultShortcut: { key: 'a', mod: true, shift: true }, run: openUsage });
});
