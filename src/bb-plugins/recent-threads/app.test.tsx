// @vitest-environment jsdom
import { act, cleanup, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginCommandRegistration } from '@get-bb/plugin-sdk/app';
import type { RecentView } from './contracts.ts';

const app = await loadPluginApp(() => import('./app.tsx'));
// SAFETY: the collector includes commands at runtime but omits them from CapturedPluginApp's declared Pick.
const command = (app as unknown as { commandPaletteActions: PluginCommandRegistration[] }).commandPaletteActions
  .find(row => row.id === 'toggle')!;
const footer = app.experimentalSidebarFooterItems.find(item => item.id === 'toggle')!;

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

it('registers Alt+R command and Clock footer action', () => {
  expect(command.title).toBe('Toggle recent threads view');
  expect(command.defaultShortcut).toMatchObject({ key: 'r', alt: true });
  expect(footer).toMatchObject({ kind: 'action', id: 'toggle', label: 'Recent threads', icon: 'Clock' });
});

it('toggles via command and footer action and updates footer active state', async () => {
  let state: RecentView = { mode: 'project', restoreMode: 'project' };
  const button = document.createElement('button');
  button.setAttribute('data-testid', 'plugin-sidebar-footer-item-recent-threads-toggle');
  document.body.appendChild(button);

  const dispose = await app.contentScripts[0]!.mount({
    pluginId: 'recent-threads',
    generation: 1,
    signal: new AbortController().signal,
  });

  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: {
      view: () => state,
      toggle: () => {
        state = state.mode === 'chronological'
          ? { mode: state.restoreMode, restoreMode: state.restoreMode }
          : { mode: 'chronological', restoreMode: 'project' };
        return state;
      },
    },
  });

  await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('false'));

  act(() => { void command.run({} as never); });
  await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
  expect(button.classList.contains('rt-active')).toBe(true);

  if (footer.kind === 'action') {
    act(() => { void footer.onActivate({ openPluginDetails: () => {} }); });
  }
  await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('false'));
  expect(button.classList.contains('rt-active')).toBe(false);

  await overlay.emitRealtime('state', { mode: 'chronological', restoreMode: 'project' });
  await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));

  if (typeof dispose === 'function') await dispose();
});
