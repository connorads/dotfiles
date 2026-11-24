// @vitest-environment jsdom
import { act, cleanup, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginCommandRegistration } from '@get-bb/plugin-sdk/app';
import type { RecentView } from './contracts.ts';

const app = await loadPluginApp(() => import('./app.tsx'));
// SAFETY: the collector includes commands at runtime but omits them from CapturedPluginApp's declared Pick.
const commands = (app as unknown as { commandPaletteActions: PluginCommandRegistration[] }).commandPaletteActions;
const command = commands.find(row => row.id === 'toggle')!;
const archivedCommand = commands.find(row => row.id === 'archived')!;
const footer = app.experimentalSidebarFooterItems.find(item => item.id === 'toggle')!;
const archivedFooter = app.experimentalSidebarFooterItems.find(item => item.id === 'archived')!;

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function footerButton(itemId: string) {
  const button = document.createElement('button');
  button.setAttribute('data-testid', `plugin-sidebar-footer-item-recent-threads-${itemId}`);
  document.body.appendChild(button);
  return button;
}

const activate = (item: typeof footer) => {
  if (item.kind === 'action') act(() => { void item.onActivate({ openPluginDetails: () => {} }); });
};

it('registers Alt+R recent command, archived command and both footer actions', () => {
  expect(command.title).toBe('Toggle recent threads view');
  expect(command.defaultShortcut).toMatchObject({ key: 'r', alt: true });
  expect(archivedCommand.title).toBe('Toggle archived threads view');
  expect(footer).toMatchObject({ kind: 'action', id: 'toggle', label: 'Recent threads', icon: 'Clock' });
  expect(archivedFooter).toMatchObject({ kind: 'action', id: 'archived', label: 'Archived threads', icon: 'Archive' });
});

it('toggles both views via commands and footer actions and updates footer active state', async () => {
  let state: RecentView = { mode: 'project', restoreMode: 'project', lifecycles: ['active'] };
  const recentButton = footerButton('toggle');
  const archivedButton = footerButton('archived');

  const dispose = await app.contentScripts[0]!.mount({
    pluginId: 'recent-threads',
    generation: 1,
    signal: new AbortController().signal,
  });

  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: {
      view: () => state,
      toggle: () => {
        state = { ...state, mode: state.mode === 'chronological' ? state.restoreMode : 'chronological' };
        return state;
      },
      toggleArchived: () => {
        state = { ...state, lifecycles: state.lifecycles[0] === 'archived' ? ['active'] : ['archived'] };
        return state;
      },
    },
  });

  await waitFor(() => expect(recentButton.getAttribute('aria-pressed')).toBe('false'));
  expect(archivedButton.getAttribute('aria-pressed')).toBe('false');

  act(() => { void command.run({} as never); });
  await waitFor(() => expect(recentButton.getAttribute('aria-pressed')).toBe('true'));
  expect(recentButton.classList.contains('rt-active')).toBe(true);

  activate(archivedFooter);
  await waitFor(() => expect(archivedButton.getAttribute('aria-pressed')).toBe('true'));
  expect(recentButton.getAttribute('aria-pressed')).toBe('true');

  act(() => { void archivedCommand.run({} as never); });
  await waitFor(() => expect(archivedButton.getAttribute('aria-pressed')).toBe('false'));

  activate(footer);
  await waitFor(() => expect(recentButton.getAttribute('aria-pressed')).toBe('false'));
  expect(recentButton.classList.contains('rt-active')).toBe(false);

  await overlay.emitRealtime('state', { mode: 'chronological', restoreMode: 'project', lifecycles: ['archived'] });
  await waitFor(() => expect(recentButton.getAttribute('aria-pressed')).toBe('true'));
  expect(archivedButton.getAttribute('aria-pressed')).toBe('true');

  if (typeof dispose === 'function') await dispose();
});
