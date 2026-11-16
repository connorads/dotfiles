// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginBrowserBbSdk, PluginCommandRegistration } from '@get-bb/plugin-sdk/app';
import { ShortcutPopover } from './popover.tsx';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); localStorage.clear(); });

const bindings = [
  { command: 'thread.new', shortcut: { key: 'o', mod: true, shift: true }, desktopOnly: false, when: { all: [], none: [] } },
  { command: 'thread.search', shortcut: { key: 'k', mod: true }, desktopOnly: false, when: { all: [], none: [] } },
  { command: 'pane.focus.left', shortcut: { key: 'ArrowLeft', mod: true, shift: true }, desktopOnly: false, when: { all: [], none: [] } },
];
// SAFETY: this SDK fake supplies the configuration fields the reference reads.
const config = { keybindings: bindings, defaultKeybindings: bindings, keybindingOverrides: [] } as unknown as Awaited<ReturnType<PluginBrowserBbSdk['system']['config']>>;
// SAFETY: this SDK fake supplies plugin identity and enablement, which the catalogue reads.
const plugins = { plugins: [{ id: 'git-glance', enabled: true }] } as unknown as Awaited<ReturnType<PluginBrowserBbSdk['plugins']['list']>>;

function render(fail = false, load: () => Promise<typeof config> = async () => { if (fail) throw new Error('Offline'); return config; }, list = plugins) {
  const draft = document.createElement('textarea');
  draft.value = 'Keep my draft';
  document.body.append(draft);
  draft.focus();
  function Surface() {
    const [closed, setClosed] = useState(false);
    return closed ? null : <ShortcutPopover returnFocus={draft} instant onClose={() => setClosed(true)} />;
  }
  const slot = renderSlot({ component: Surface }, {}, {
    sdk: { system: { config: load }, plugins: { list: async () => list } },
  });
  return { slot, draft };
}

test('search finds a non-essential command and shows its chord', async () => {
  const { slot, draft } = render();
  await slot.findByRole('button', { name: 'Practise New thread' });
  expect(slot.queryByRole('button', { name: 'Practise Focus pane left' })).toBeNull();
  fireEvent.change(slot.getByRole('searchbox'), { target: { value: 'pane left' } });
  expect(slot.getByRole('button', { name: 'Practise Focus pane left' }).textContent).toContain('←');
  expect(slot.queryByRole('button', { name: 'Practise New thread' })).toBeNull();
  expect(draft.value).toBe('Keep my draft');
  draft.remove();
});

test('favouriting survives remount and can be removed from Favourites', async () => {
  const first = render();
  fireEvent.click(await first.slot.findByRole('button', { name: 'Favourite Git Glance' }));
  expect(first.slot.getByRole('button', { name: 'Favourite Git Glance' }).getAttribute('aria-pressed')).toBe('true');
  first.slot.unmount(); first.draft.remove();
  const second = render();
  await second.slot.findByRole('button', { name: 'Practise Git Glance' });
  fireEvent.click(second.slot.getByRole('button', { name: /^Favourites/ }));
  expect(second.slot.queryByRole('button', { name: 'Practise New thread' })).toBeNull();
  fireEvent.click(second.slot.getByRole('button', { name: 'Favourite Git Glance' }));
  expect(second.slot.queryByRole('button', { name: 'Practise Git Glance' })).toBeNull();
  expect(second.slot.getByText(/Star shortcuts/)).toBeTruthy();
  second.draft.remove();
});

test('Escape restores draft focus without changing its text', async () => {
  const { slot, draft } = render();
  await slot.findByRole('button', { name: 'Practise New thread' });
  expect(document.activeElement).toBe(slot.getByRole('searchbox'));
  fireEvent.change(slot.getByRole('searchbox'), { target: { value: 'new' } });
  let escaped = false;
  const onKey = () => { escaped = true; };
  window.addEventListener('keydown', onKey);
  fireEvent.keyDown(slot.getByRole('searchbox'), { key: 'Escape' });
  window.removeEventListener('keydown', onKey);
  await waitFor(() => expect(slot.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(draft);
  expect(draft.value).toBe('Keep my draft');
  expect(escaped).toBe(false);
  draft.remove();
});

test('arrow keys browse and the star shortcut saves the selected command', async () => {
  const { slot, draft } = render();
  await slot.findByRole('button', { name: 'Practise New thread' });
  const search = slot.getByRole('searchbox');
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 's', ctrlKey: true });
  expect(slot.getByRole('button', { name: 'Favourite Search threads' }).getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(search);
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(slot.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(draft);
  draft.remove();
});

test('the Favourites badge counts only starred commands the guide lists', async () => {
  localStorage.setItem('bb-plugin-shortcut-guide.favourites', JSON.stringify(['thread.new', 'plugin:lazygit/open']));
  const { slot, draft } = render();
  await slot.findByRole('button', { name: 'Practise New thread' });
  expect(slot.getByRole('button', { name: /^Favourites/ }).textContent).toBe('Favourites1');
  draft.remove();
});

test('the star chord on a focused command stars that row and keeps the browser from saving the page', async () => {
  const { slot, draft } = render();
  const command = await slot.findByRole('button', { name: 'Practise Search threads' });
  command.focus();
  expect(fireEvent.keyDown(command, { key: 's', metaKey: true })).toBe(false);
  expect(slot.getByRole('button', { name: 'Favourite Search threads' }).getAttribute('aria-pressed')).toBe('true');
  expect(fireEvent.keyDown(slot.getByRole('button', { name: 'Essentials' }), { key: 's', metaKey: true })).toBe(false);
  expect(slot.getAllByRole('button', { pressed: true, name: /^Favourite / })).toHaveLength(1);
  draft.remove();
});

test('hovering a row selects it without scrolling the list; arrow keys still reveal the selection', async () => {
  const scrolled: Element[] = [];
  Element.prototype.scrollIntoView = function () { scrolled.push(this); };
  try {
    const { slot, draft } = render();
    const command = await slot.findByRole('button', { name: 'Practise Search threads' });
    scrolled.length = 0;
    fireEvent.pointerMove(command);
    expect(command.parentElement?.dataset.selected).toBe('true');
    expect(scrolled).toHaveLength(0);
    fireEvent.keyDown(slot.getByRole('searchbox'), { key: 'ArrowDown' });
    expect(scrolled).toHaveLength(1);
    draft.remove();
  } finally { delete (Element.prototype as Partial<Element>).scrollIntoView; }
});

test('loading shows no shortcut count, and an empty Essentials view does not ask for stars', async () => {
  let resolve: (value: typeof config) => void = () => {};
  // SAFETY: an SDK fake with every plugin disabled.
  const none = { plugins: [] } as unknown as typeof plugins;
  const { slot, draft } = render(false, () => new Promise(done => { resolve = done; }), none);
  await slot.findByText('Loading your shortcuts…');
  expect(slot.container.ownerDocument.querySelector('.sg-count')?.textContent).toBe('');
  // SAFETY: an empty SDK config fake, as BB returns with no bindings.
  resolve({ keybindings: [], defaultKeybindings: [], keybindingOverrides: [] } as unknown as typeof config);
  expect(await slot.findByText('BB reports none of the listed shortcuts for this client.')).toBeTruthy();
  draft.remove();
});

test('failed loading is visible and the close button remains usable', async () => {
  const { slot, draft } = render(true);
  expect((await slot.findByRole('alert')).textContent).toContain('Offline');
  fireEvent.click(slot.getByRole('button', { name: 'Close shortcut guide' }));
  expect(slot.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(draft);
  draft.remove();
});

test('the registered guide is available on the new-thread screen', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  expect(app.appOverlays).toHaveLength(1);
  expect(app.threadHeaderActions).toHaveLength(1);
  // SAFETY: the collector includes commands at runtime but omits them from CapturedPluginApp's declared Pick.
  const commands = (app as unknown as { commandPaletteActions: PluginCommandRegistration[] }).commandPaletteActions;
  const command = commands.find(row => row.id === 'toggle');
  expect(command?.defaultShortcut).toMatchObject({ key: '/', alt: true });
  expect(command).not.toHaveProperty('isAvailable');
});
