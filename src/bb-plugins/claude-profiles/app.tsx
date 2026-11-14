import { definePluginApp } from '@get-bb/plugin-sdk/app';
import { Chip } from './ui/switcher/chip.tsx';
import { ConnectorSettings } from './ui/switcher/settings.tsx';
import { command, CommandOwner, Overlay } from './ui/switcher/switcher.tsx';
import { open as openSwitcher } from './ui/switcher/store.ts';
import { hideNativePicker } from './ui/switcher/hide-native.ts';
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
  app.slots.settingsSection({ id: 'connectors', title: 'Claude account connectors',
    description: 'Apps connected through each Claude account, such as Slack. Off by default.', component: ConnectorSettings });
  app.slots.experimental_appOverlay({ id: 'switcher', component: Overlay });
  app.composer.customize({ id: 'agent-switcher', scopes: ['thread', 'new-thread'],
    banners: [{ id: 'command-owner', chrome: 'bare', component: CommandOwner }],
    actions: [{ id: 'switcher', component: Chip }],
    plusMenu: [{ id: 'switcher', label: 'Switch model', icon: 'Star', run: ({ composer }) => openSwitcher(composer) }],
  });
  app.composer.experimental_registerCommand({ id: 'open-switcher', title: 'Switch model',
    defaultShortcut: { key: 'm', mod: true, shift: true }, run: ({ composer }) => openSwitcher(composer) });
  for (let slot = 1; slot <= 9; slot++) app.composer.experimental_registerCommand({ id: `select-favourite-${slot}`,
    title: `Select favourite model ${slot}`, defaultShortcut: { key: String(slot), alt: true },
    run: ({ composer }) => command(composer, controller => controller.select(slot)) });
  app.slots.experimental_threadHeaderAction({ id: 'usage', title: 'Usage', component: ThreadUsage });
  app.slots.experimental_appOverlay({ id: 'usage-overview', component: UsageOverlay });
  app.slots.experimental_appOverlay({ id: 'account-badges', component: BadgeBridge });
  app.contentScripts.register({ id: 'workflow-accounts', mount: () => mountWorkflowAccounts(document) });
  app.contentScripts.register({ id: 'account-badges', mount: () => mountAccountBadges(document) });
  app.contentScripts.register({ id: 'hide-native-picker', mount: () => hideNativePicker(document) });
  app.commands.register({ id: 'show-usage', title: 'Show agent usage', defaultShortcut: { key: 'a', mod: true, shift: true }, run: openUsage });
});
