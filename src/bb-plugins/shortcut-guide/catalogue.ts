import type { PluginCommandShortcut } from '@get-bb/plugin-sdk/app';

export type Shortcut = PluginCommandShortcut;
export type Platform = 'mac' | 'windows' | 'linux';
export type View = 'essentials' | 'favourites' | 'all';
export type Group = 'Threads' | 'Composer' | 'Panes & panels' | 'Tools' | 'App';
export const groups: readonly Group[] = ['Threads', 'Composer', 'Panes & panels', 'Tools', 'App'];
export interface Binding {
  command: string;
  shortcut: Shortcut | null;
  desktopOnly: boolean;
  when: { all: readonly string[]; none: readonly string[] };
}
interface Override { command: string; shortcut: Shortcut | null; platform?: Platform }
export interface CatalogueData {
  bindings: readonly Binding[];
  overrides: readonly Override[];
  plugins: readonly { id: string; enabled: boolean }[];
}
export interface Command {
  id: string;
  title: string;
  description: string;
  group: Group;
  essential: boolean;
  shortcut: Shortcut | null;
}
interface Entry extends Omit<Command, 'shortcut'> { plugin?: string; defaultShortcut?: Shortcut }

// This is a reference selection, not a mirror of BB's full command catalogue.
const entries: readonly Entry[] = [
  { id: 'thread.new', title: 'New thread', description: 'Start a conversation in this project.', group: 'Threads', essential: true },
  { id: 'thread.search', title: 'Search threads', description: 'Find a conversation by name.', group: 'Threads', essential: true },
  { id: 'thread.previous', title: 'Previous thread', description: 'Move up the visible sidebar threads.', group: 'Threads', essential: true },
  { id: 'thread.next', title: 'Next thread', description: 'Move down the visible sidebar threads.', group: 'Threads', essential: true },
  { id: 'thread.rename', title: 'Rename thread', description: 'Give the focused conversation a name.', group: 'Threads', essential: false },
  { id: 'thread.archive', title: 'Archive thread', description: 'Archive the focused conversation.', group: 'Threads', essential: false },
  { id: 'composer.focus', title: 'Focus composer', description: 'Return to your draft.', group: 'Composer', essential: true },
  { id: 'modelPicker.toggle', title: 'Native model picker', description: 'Choose a model in BB’s built-in picker.', group: 'Composer', essential: false },
  { id: 'pane.focus.left', title: 'Focus pane left', description: 'Move to the conversation on the left.', group: 'Panes & panels', essential: false },
  { id: 'pane.focus.right', title: 'Focus pane right', description: 'Move to the conversation on the right.', group: 'Panes & panels', essential: false },
  { id: 'pane.focus.up', title: 'Focus pane above', description: 'Move to the conversation above.', group: 'Panes & panels', essential: false },
  { id: 'pane.focus.down', title: 'Focus pane below', description: 'Move to the conversation below.', group: 'Panes & panels', essential: false },
  { id: 'pane.maximize.toggle', title: 'Maximise pane', description: 'Expand this conversation or restore its layout.', group: 'Panes & panels', essential: false },
  { id: 'panel.toggle', title: 'Toggle side panel', description: 'Show or hide the files and terminal panel.', group: 'Panes & panels', essential: true },
  { id: 'panel.newTab', title: 'New panel tab', description: 'Open another tab in the side panel.', group: 'Panes & panels', essential: false },
  { id: 'panel.close', title: 'Close panel tab', description: 'Close the selected side-panel tab.', group: 'Panes & panels', essential: false },
  { id: 'panel.nextTab', title: 'Next panel tab', description: 'Move to the next side-panel tab.', group: 'Panes & panels', essential: false },
  { id: 'panel.previousTab', title: 'Previous panel tab', description: 'Move to the previous side-panel tab.', group: 'Panes & panels', essential: false },
  { id: 'terminal.open', title: 'Open terminal', description: 'Open a shell for this checkout.', group: 'Tools', essential: true },
  { id: 'file.quickOpen', title: 'Find file', description: 'Find a file in this checkout.', group: 'Tools', essential: true },
  { id: 'palette.open', title: 'Command palette', description: 'Search and run BB commands.', group: 'App', essential: true },
  { id: 'sidebar.toggle', title: 'Toggle sidebar', description: 'Show or hide the thread list.', group: 'App', essential: false },
  { id: 'settings.open', title: 'Settings', description: 'Edit shortcuts in the Keyboard section.', group: 'App', essential: false },
  { id: 'history.back', title: 'Go back', description: 'Return to the previous page.', group: 'App', essential: false },
  { id: 'history.forward', title: 'Go forward', description: 'Revisit the next page.', group: 'App', essential: false },
  { id: 'plugin:git-glance/toggle', plugin: 'git-glance', title: 'Git Glance', description: 'Branches, changes, diffs and recent commits.', group: 'Tools', essential: true, defaultShortcut: { key: 'g', alt: true } },
  { id: 'plugin:claude-profiles/open-picker', plugin: 'claude-profiles', title: 'Switch model', description: 'Search models, favourites and saved effort.', group: 'Composer', essential: true, defaultShortcut: { key: 'f', alt: true } },
  { id: 'plugin:claude-profiles/open-switcher', plugin: 'claude-profiles', title: 'Switch Claude account', description: 'Choose the account for this conversation.', group: 'Composer', essential: false, defaultShortcut: { key: 'a', alt: true } },
  { id: 'plugin:claude-profiles/next-favourite', plugin: 'claude-profiles', title: 'Next favourite model', description: 'Cycle through your saved models.', group: 'Composer', essential: false, defaultShortcut: { key: 'f', alt: true, shift: true } },
  { id: 'plugin:claude-profiles/show-usage', plugin: 'claude-profiles', title: 'Agent usage', description: 'Compare account allowances and reset times.', group: 'Tools', essential: true, defaultShortcut: { key: 'a', mod: true, shift: true } },
  { id: 'plugin:skill-loader/pick', plugin: 'skill-loader', title: 'Find a skill', description: 'Search the skill catalogue for this draft.', group: 'Composer', essential: false, defaultShortcut: { key: 's', alt: true } },
  { id: 'plugin:diff-viewer/open', plugin: 'diff-viewer', title: 'Diff viewer', description: 'Read the checkout’s changes together.', group: 'Tools', essential: false, defaultShortcut: { key: 'd', mod: true, shift: true } },
  { id: 'plugin:lazygit/open', plugin: 'lazygit', title: 'Lazygit', description: 'Open the full Git interface.', group: 'Tools', essential: false, defaultShortcut: { key: 'g', mod: true, shift: true } },
  { id: 'plugin:machine-health/toggle', plugin: 'machine-health', title: 'Machine health', description: 'Memory, CPU, battery and running agents.', group: 'Tools', essential: false, defaultShortcut: { key: 'h', alt: true } },
  { id: 'plugin:caffeine/toggle', plugin: 'caffeine', title: 'Keep awake', description: 'Choose how long this Mac stays awake.', group: 'Tools', essential: false, defaultShortcut: { key: 'k', alt: true } },
  { id: 'plugin:shortcut-guide/toggle', plugin: 'shortcut-guide', title: 'Shortcut guide', description: 'Open or close this reference.', group: 'App', essential: false, defaultShortcut: { key: '/', alt: true } },
];

function available(binding: Binding, client: { platform: Platform; desktop: boolean }): boolean {
  if (binding.desktopOnly && !client.desktop) return false;
  if (binding.when.all.includes('webSurface') && client.desktop) return false;
  if (binding.when.none.includes('webSurface') && !client.desktop) return false;
  return (['mac', 'windows', 'linux'] as const).every(platform =>
    !(binding.when.all.includes(`${platform}Platform`) && client.platform !== platform)
    && !(binding.when.none.includes(`${platform}Platform`) && client.platform === platform));
}

export function catalogue(data: CatalogueData, client: { platform: Platform; desktop: boolean }): Command[] {
  const enabled = new Set(data.plugins.filter(plugin => plugin.enabled).map(plugin => plugin.id));
  const bindings = data.bindings.filter(binding => available(binding, client));
  const override = (id: string) => data.overrides.find(row => row.command === id && row.platform === client.platform)
    ?? data.overrides.find(row => row.command === id && row.platform === undefined);
  return entries.flatMap(entry => {
    const binding = [...bindings].reverse().find(row => row.command === entry.id);
    if (entry.plugin ? !enabled.has(entry.plugin) : !binding) return [];
    const custom = override(entry.id);
    let shortcut = custom ? custom.shortcut : binding?.shortcut ?? entry.defaultShortcut ?? null;
    // BB leaves a plugin's default unbound when another command owns the chord.
    if (entry.plugin && !custom && shortcut && bindings.some(row => {
      const customBinding = override(row.command);
      const effective = customBinding ? customBinding.shortcut : row.shortcut;
      return row.command !== entry.id && effective
        && keycaps(effective, client.platform).join('') === keycaps(shortcut, client.platform).join('');
    })) shortcut = null;
    return [{ id: entry.id, title: entry.title, description: entry.description, group: entry.group, essential: entry.essential, shortcut }];
  });
}

export function keycaps(shortcut: Shortcut | null, platform: Platform): string[] {
  if (!shortcut) return [];
  const mac = platform === 'mac';
  const keys: string[] = [];
  if (shortcut.control || (shortcut.mod && !mac)) keys.push(mac ? '⌃' : 'Ctrl');
  if (!mac && shortcut.alt) keys.push('Alt');
  if (shortcut.shift) keys.push(mac ? '⇧' : 'Shift');
  if (mac && shortcut.alt) keys.push('⌥');
  if (shortcut.meta || (shortcut.mod && mac)) keys.push(mac ? '⌘' : 'Meta');
  const names: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: '↵', Escape: 'Esc', ' ': 'Space', Tab: 'Tab', Backspace: '⌫' };
  keys.push(names[shortcut.key] ?? shortcut.key.toUpperCase());
  return keys;
}

export function visibleCommands(rows: readonly Command[], { query, view, favourites, platform }: {
  query: string; view: View; favourites: readonly string[]; platform: Platform;
}): Command[] {
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  return rows.filter(row => {
    if (!terms.length) return view === 'all' || (view === 'essentials' ? row.essential : favourites.includes(row.id));
    const caps = keycaps(row.shortcut, platform).join(' ');
    const words = caps.replaceAll('⌘', 'cmd command').replaceAll('⌥', 'alt option').replaceAll('⇧', 'shift').replaceAll('⌃', 'ctrl control');
    const text = `${row.title} ${row.description} ${row.group} ${caps} ${words}`.toLowerCase();
    return terms.every(term => text.includes(term));
  });
}
