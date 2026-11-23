// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderSlot, type RenderedSlot } from '@get-bb/plugin-sdk/testing/app';
import { FolderPicker } from './folder-picker.tsx';
import type { FolderList, HostRepo, RepositoryList, rpcContract } from './contracts.ts';

const home = '/Users/alex';
const base = `${home}/.bb/plugins/environment-personal-workspace/host-data/workspaces/thr_123`;
const parent = `${home}/.bb/plugins/environment-personal-workspace/host-data/workspaces`;

const listings: Record<string, FolderList> = {
  '.': {
    root: base, base, home, parent, dotfiles: true, path: '.', repository: false, repoKind: null,
    folders: [{ name: 'opencode', repository: true }], worktrees: [],
  },
  [base]: {
    root: base, base, home, parent, dotfiles: true, path: '.', repository: false, repoKind: null,
    folders: [{ name: 'opencode', repository: true }], worktrees: [],
  },
  [parent]: {
    root: parent, base, home, parent: `${home}/.bb/plugins/environment-personal-workspace/host-data`, dotfiles: true, path: parent, repository: false, repoKind: null,
    folders: [{ name: 'thr_123', repository: false }, { name: 'thr_456', repository: false }], worktrees: [],
  },
  [home]: {
    root: home, base, home, parent: '/Users', dotfiles: true, path: home, repository: true, repoKind: 'dotfiles',
    folders: [{ name: 'src', repository: false }], worktrees: [],
  },
  [`${home}/src`]: {
    root: `${home}/src`, base, home, parent: home, dotfiles: true, path: `${home}/src`, repository: false, repoKind: null,
    folders: [{ name: 'bb-plugins', repository: true }], worktrees: [],
  },
  '~/src': {
    root: `${home}/src`, base, home, parent: home, dotfiles: true, path: `${home}/src`, repository: false, repoKind: null,
    folders: [{ name: 'bb-plugins', repository: true }], worktrees: [],
  },
  '/Users': {
    root: '/Users', base, home, parent: '/', dotfiles: true, path: '/Users', repository: false, repoKind: null,
    folders: [{ name: 'alex', repository: true }], worktrees: [],
  },
};

const nestedByRoot: Record<string, RepositoryList> = {
  [base]: { repositories: ['opencode'], truncated: false },
  [parent]: { repositories: ['thr_123/opencode'], truncated: false },
  [home]: { repositories: ['src/bb-plugins'], truncated: false },
  [`${home}/src`]: { repositories: ['bb-plugins'], truncated: false },
  '/Users': { repositories: [], truncated: false, skipped: true },
};

const defaultHost: HostRepo[] = [
  { path: `${home}/src/bb-plugins`, label: 'BB Plugins', source: 'project' },
  { path: `${home}/src`, label: 'Sources', source: 'project' },
];

let slot: RenderedSlot | undefined;
const { waitFor } = vi;
const key = (target: HTMLElement, value: string) =>
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); });
const setInput = (input: HTMLInputElement, value: string) => act(() => {
  Reflect.set(HTMLInputElement.prototype, 'value', value, input);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(() => { vi.stubGlobal('CSS', { escape: (value: string) => value }); });
afterEach(() => { slot?.lifecycle.unmount(); slot = undefined; vi.unstubAllGlobals(); });

function renderPicker(overrides: {
  select?: (input: { threadId: string; path: string | null; worktree?: string }) => Record<string, never>;
  host?: HostRepo[];
} = {}) {
  const onSelected = vi.fn(async () => {});
  const select = vi.fn(overrides.select ?? (() => ({})));
  const folders = vi.fn(({ path }: { path: string }) => {
    const found = listings[path];
    if (!found) throw new Error(`Folder not found: ${path}`);
    return found;
  });
  slot = renderSlot<Parameters<typeof FolderPicker>[0], Pick<typeof rpcContract, 'folders' | 'repositories' | 'recentPicks' | 'select'>>(
    { component: FolderPicker },
    { threadId: 't', embedded: true, onSelected },
    {
      rpc: {
        folders,
        repositories: ({ path }) => nestedByRoot[path] ?? { repositories: [], truncated: false },
        recentPicks: () => ({ picks: [], host: overrides.host ?? defaultHost }),
        select,
      },
    },
  );
  return { view: slot, select, folders, onSelected };
}

it('climbs above the thread folder with Left arrow and restores focus to the left folder', async () => {
  const { view } = renderPicker();
  const input = await view.findByRole('textbox') as HTMLInputElement;
  await view.findByText('opencode');

  key(input, 'ArrowLeft');
  const leftFolder = await view.findByRole('button', { name: 'thr_123' });
  await waitFor(() => expect(view.baseElement.ownerDocument.activeElement).toBe(leftFolder));
});

it('jumps straight to Dotfiles or Home from a deep thread folder', async () => {
  const { view, select, onSelected } = renderPicker();
  await view.findByText('opencode');

  act(() => view.getByRole('button', { name: 'Home' }).click());
  await view.findByRole('button', { name: 'Use dotfiles' });

  act(() => view.getByRole('button', { name: 'Dotfiles' }).click());
  await waitFor(() => expect(select).toHaveBeenCalledWith({ threadId: 't', path: home }));
  await waitFor(() => expect(onSelected).toHaveBeenCalledTimes(1));
});

it('matches dotfiles and host repositories from search and selects on Enter', async () => {
  const { view, select } = renderPicker();
  const input = await view.findByRole('textbox') as HTMLInputElement;
  await view.findByText('opencode');

  setInput(input, 'dot');
  await view.findByText('Elsewhere on this host');
  key(input, 'Enter');
  await waitFor(() => expect(select).toHaveBeenCalledWith({ threadId: 't', path: home }));
});

it('opens typed paths directly and preserves the query on missing paths', async () => {
  const { view } = renderPicker();
  const input = await view.findByRole('textbox') as HTMLInputElement;
  await view.findByText('opencode');

  setInput(input, '~/nope');
  key(input, 'Enter');
  await view.findByRole('alert');
  expect(input.value).toBe('~/nope');
  expect(view.getByRole('button', { name: 'Home' })).toBeTruthy();

  setInput(input, '~/src');
  key(input, 'Enter');
  await view.findByText('bb-plugins');
  expect(input.value).toBe('');
});

it('falls back to browsing when a clicked BB project folder is not itself a git repository', async () => {
  const { view, select } = renderPicker({
    select: ({ path }) => {
      if (path === `${home}/src`) throw new Error('Folder is not a git repository.');
      return {};
    },
  });
  await view.findByText('Sources');
  act(() => view.getByRole('button', { name: /^Sources/ }).click());
  await waitFor(() => expect(select).toHaveBeenCalledWith({ threadId: 't', path: `${home}/src` }));
  await view.findByText('bb-plugins');
});
