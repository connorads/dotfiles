import { expect, test } from 'vitest';
import { catalogue, keycaps, visibleCommands, type Binding, type Command } from './catalogue.ts';

const shortcut = { key: 'k', mod: true };
const binding: Binding = { command: 'thread.search', shortcut, desktopOnly: false, when: { all: ['mainSurface'], none: [] } };
const client = { platform: 'mac' as const, desktop: true };

test('shows effective native overrides and excludes another platform', () => {
  const commands = catalogue({ bindings: [binding, { ...binding, command: 'thread.next', shortcut: { key: ']', control: true },
    when: { all: ['windowsPlatform'], none: [] } }], overrides: [{ command: 'thread.search', shortcut: { key: 's', alt: true } }], plugins: [] }, client);
  expect(commands.find(row => row.id === 'thread.search')?.shortcut).toEqual({ key: 's', alt: true });
  expect(commands.some(row => row.id === 'thread.next')).toBe(false);
});

test('platform overrides beat global overrides, including disabled bindings', () => {
  const rows = catalogue({ bindings: [binding], overrides: [
    { command: 'thread.search', shortcut }, { command: 'thread.search', platform: 'mac', shortcut: null },
  ], plugins: [] }, client);
  expect(rows.find(row => row.id === 'thread.search')?.shortcut).toBeNull();
});

test('plugin rows require an enabled plugin and respect rebinding and collisions', () => {
  const data = { bindings: [{ ...binding, shortcut: { key: 'g', alt: true } }], overrides: [], plugins: [{ id: 'git-glance', enabled: true }] };
  expect(catalogue(data, client).find(row => row.id === 'plugin:git-glance/toggle')?.shortcut).toBeNull();
  expect(catalogue({ ...data, overrides: [{ command: 'plugin:git-glance/toggle', shortcut: { key: 'j', alt: true } }] }, client)
    .find(row => row.id === 'plugin:git-glance/toggle')?.shortcut).toEqual({ key: 'j', alt: true });
  expect(catalogue({ ...data, plugins: [{ id: 'git-glance', enabled: false }] }, client).some(row => row.id.startsWith('plugin:git-glance'))).toBe(false);
});

const rows: Command[] = [
  { id: 'git', title: 'Git status', description: 'Changes and recent commits', group: 'Tools', essential: true, shortcut: { key: 'g', alt: true } },
  { id: 'search', title: 'Search threads', description: 'Find a conversation', group: 'Threads', essential: false, shortcut },
];

test('starts with essentials, filters favourites, and searches beyond the selected view', () => {
  expect(visibleCommands(rows, { query: '', view: 'essentials', favourites: [], platform: 'mac' }).map(row => row.id)).toEqual(['git']);
  expect(visibleCommands(rows, { query: '', view: 'favourites', favourites: ['search'], platform: 'mac' }).map(row => row.id)).toEqual(['search']);
  expect(visibleCommands(rows, { query: 'conversation', view: 'essentials', favourites: [], platform: 'mac' }).map(row => row.id)).toEqual(['search']);
  expect(visibleCommands(rows, { query: 'alt g', view: 'favourites', favourites: [], platform: 'mac' }).map(row => row.id)).toEqual(['git']);
  expect(visibleCommands(rows, { query: 'cmd k', view: 'essentials', favourites: [], platform: 'mac' }).map(row => row.id)).toEqual(['search']);
});

test('keycaps match platform modifiers and avoid duplicate Command keys', () => {
  expect(keycaps({ key: 'ArrowLeft', mod: true, meta: true, shift: true }, 'mac')).toEqual(['⇧', '⌘', '←']);
  expect(keycaps({ key: 'Enter', mod: true, alt: true }, 'windows')).toEqual(['Ctrl', 'Alt', '↵']);
});
