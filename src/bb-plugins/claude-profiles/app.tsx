import { definePluginApp } from '@get-bb/plugin-sdk/app';
import { AccountStatus, isClaude, openAccount } from './ui/account-status.tsx';
import { command, CommandOwner, Overlay, Trigger } from './ui/picker/picker.tsx';
import { open as openPicker } from './ui/picker/store.ts';
import { ThreadUsage } from './ui/usage/badge.tsx';
import { UsageOverlay } from './ui/usage/overlay.tsx';
import { openUsage } from './ui/usage/overlay-store.ts';

export default definePluginApp(app => {
  app.composer.customize({
    id: 'claude-account', scopes: ['thread', 'new-thread'],
    actions: [{ id: 'claude-account', component: AccountStatus }],
  });
  app.composer.experimental_registerCommand({ id: 'open-switcher', title: 'Agent Switcher: switch account',
    run: ({ composer }) => { if (isClaude(composer)) openAccount(composer); } });
  app.slots.experimental_appOverlay({ id: 'picker', component: Overlay });
  app.composer.customize({ id: 'agent-switcher', scopes: ['thread', 'new-thread'],
    banners: [{ id: 'command-owner', chrome: 'bare', component: CommandOwner }],
    actions: [{ id: 'picker', component: Trigger }],
    plusMenu: [{ id: 'picker', label: 'Switch model', icon: 'Star', run: ({ composer }) => openPicker(composer) }],
  });
  app.composer.experimental_registerCommand({ id: 'open-picker', title: 'Agent Switcher: open picker',
    defaultShortcut: { key: 'f', alt: true }, run: ({ composer }) => openPicker(composer) });
  app.composer.experimental_registerCommand({ id: 'next-favourite', title: 'Agent Switcher: next favourite',
    defaultShortcut: { key: 'f', alt: true, shift: true }, run: ({ composer }) => command(composer, controller => controller.cycle(1)) });
  app.composer.experimental_registerCommand({ id: 'previous-favourite', title: 'Agent Switcher: previous favourite',
    run: ({ composer }) => command(composer, controller => controller.cycle(-1)) });
  for (let slot = 1; slot <= 9; slot++) app.composer.experimental_registerCommand({ id: `select-favourite-${slot}`,
    title: `Agent Switcher: select favourite ${slot}`, run: ({ composer }) => command(composer, controller => controller.select(slot)) });
  app.slots.experimental_threadHeaderAction({ id: 'usage', title: 'Usage', component: ThreadUsage });
  app.slots.experimental_appOverlay({ id: 'usage-overview', component: UsageOverlay });
  app.commands.register({ id: 'show-usage', title: 'Agent Switcher: show usage', defaultShortcut: { key: 'a', mod: true, shift: true }, run: openUsage });
});
