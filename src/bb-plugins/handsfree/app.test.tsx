// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot, type RenderedSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginSidebarThread } from '@get-bb/plugin-sdk';
import type { Command, Reply } from './contracts.ts';
import type { rpcContract } from './rpc.ts';
import { makeArchives } from './archive.ts';

const thread = (id: string, extra: Partial<PluginSidebarThread> = {}): PluginSidebarThread => ({
  id, projectId: 'p1', title: id, titleFallback: null, displayTitle: id,
  parentThreadId: null, lifecycleOwnerThreadId: null, sourceThreadId: null, sectionId: null,
  originKind: null, originPluginId: null, providerId: 'codex', status: 'idle', runtimeStatus: 'idle',
  queuedWork: 'none', hasPendingInteraction: false,
  activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
  indicator: 'none', indicatorLabel: null, isUnread: false, isPinned: false, pinnedAt: null,
  pinSortKey: null, isArchived: false, archivedAt: null, href: '/', isHidden: false,
  environment: null, host: { id: 'h1', name: 'Mac' }, createdAt: 1, updatedAt: 1,
  lastReadAt: null, latestAttentionAt: 1, ...extra,
});
let slot: RenderedSlot | undefined;
beforeEach(() => { vi.spyOn(document, 'hasFocus').mockReturnValue(true); });
afterEach(() => { slot?.lifecycle.unmount(); slot = undefined; vi.restoreAllMocks(); });

async function render(archiveStatus = 'idle', duringInspect?: () => void) {
  const replies: Reply[] = [];
  const archived: string[] = [];
  const restored: string[] = [];
  let receipts: unknown;
  const archives = makeArchives({
    get: async id => { duringInspect?.(); return { id, title: 'Selected thread', projectId: 'p1', status: archiveStatus, archivedAt: null }; },
    children: async () => 0,
    archive: async id => { archived.push(id); return [id]; },
    unarchive: async id => { restored.push(id); },
    load: async () => receipts,
    save: async value => { receipts = structuredClone(value); },
  });
  const app = await loadPluginApp(() => import('./app.tsx'));
  const registration = app.appOverlays[0];
  if (!registration) throw new Error('Voice overlay missing');
  slot = renderSlot<object, typeof rpcContract>(registration, {}, {
    context: { threadId: 't1', projectId: 'p1' },
    composer: { scope: { kind: 'thread', threadId: 't1' }, text: 'Unsent task', selection: { providerId: 'codex', model: 'gpt-test' } },
    sidebarThreads: {
      threads: [thread('t1'), thread('waiting', { hasPendingInteraction: true }), thread('hidden', { isHidden: true, hasPendingInteraction: true }), thread('done', { indicator: 'unread-success' })],
      projects: [{ id: 'p1', name: 'dotfiles', isPersonal: false, href: '/', settingsHref: '/' }],
    },
    rpc: {
      observed: () => ({ recorded: true }),
      archiveTarget: ({ threadId }) => archives.inspect(threadId),
      archive: ({ target, confirmed }) => archives.archive(target, confirmed),
      restore: () => archives.restore(),
      claim: () => ({ claimed: true }), complete: ({ reply }) => { replies.push(reply); return { accepted: true }; },
    },
    sdk: {
      system: { config: async () => { throw new Error('No keyboard configuration in this fixture.'); } },
      providers: { models: async () => ({
        modelLoadError: null, permissionCeiling: 'full', providers: [], selectedOnlyModels: [],
        models: [{ id: 'new-model', model: 'new-model', displayName: 'New model', description: '',
          defaultReasoningEffort: 'medium', supportedReasoningEfforts: [], isDefault: false }],
      }) },
    },
  });
  const rendered = slot;
  let sequence = 0;
  return {
    archived, restored,
    slot: rendered,
    async command(command: Command) {
      const count = replies.length;
      await rendered.behavior.emitRealtime('command', { requestId: String(++sequence), command });
      await waitFor(() => expect(replies.length).toBe(count + 1));
      return replies[replies.length - 1];
    },
  };
}

test('idle archive targets the selected thread and spoken restore opens it', async () => {
  const view = await render();
  expect((await view.command({ action: 'archive' })).ok).toBe(true);
  expect(view.archived).toEqual(['t1']);
  expect(view.slot.inspection.composer.submits).toEqual([]);
  expect((await view.command({ action: 'restore' })).ok).toBe(true);
  expect(view.restored).toEqual(['t1']);
  expect(view.slot.inspection.sidebarActionCalls.at(-1)).toEqual({ method: 'open', threadId: 't1' });
});

test('running archives need explicit confirmation and another command cancels it', async () => {
  const view = await render('active');
  await view.command({ action: 'archive' });
  expect(view.archived).toEqual([]);
  expect(view.slot.getByRole('group', { name: 'Confirm archive' })).toBeTruthy();
  await view.command({ action: 'help' });
  expect((await view.command({ action: 'confirm-archive' })).ok).toBe(false);
  expect(view.archived).toEqual([]);
  await view.command({ action: 'archive' });
  await view.command({ action: 'confirm-archive' });
  expect(view.archived).toEqual(['t1']);
});

test('cancelling an archive leaves the selected thread and draft untouched', async () => {
  const view = await render('active');
  await view.command({ action: 'archive' });
  await view.command({ action: 'cancel-archive' });
  expect(view.archived).toEqual([]);
  expect(view.slot.inspection.sidebarActionCalls).toEqual([]);
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test('focus loss during archive inspection prevents the mutation', async () => {
  const view = await render('idle', () => { vi.spyOn(document, 'hasFocus').mockReturnValue(false); });
  expect((await view.command({ action: 'archive' })).ok).toBe(false);
  expect(view.archived).toEqual([]);
  expect(view.slot.inspection.sidebarActionCalls).toEqual([]);
});

test('Enter does not confirm an archive or submit the retained draft', async () => {
  const view = await render('active');
  await view.command({ action: 'archive' });
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(view.archived).toEqual([]);
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('new thread opens a draft in the current project without submitting text', async () => {
  const view = await render();
  expect((await view.command({ action: 'new' })).ok).toBe(true);
  expect(view.slot.inspection.sidebarActionCalls).toEqual([{ method: 'openNewThread', options: { projectId: 'p1', focusPrompt: true } }]);
  expect(view.slot.inspection.composer.submits).toEqual([]);
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test('choose without an open voice list returns an immediate explanation', async () => {
  const view = await render();
  expect(await view.command({ action: 'choose', number: 1 })).toMatchObject({
    ok: false, message: 'There is no such numbered voice choice. Say “voice help”.',
  });
  expect(view.slot.inspection.sidebarActionCalls).toEqual([]);
});

test('who needs me excludes hidden threads and Enter selects rather than sends the draft', async () => {
  const view = await render();
  await view.command({ action: 'attention' });
  expect(view.slot.queryByText(/hidden \(/)).toBe(null);
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  fireEvent(document, enter);
  await waitFor(() => expect(view.slot.inspection.sidebarActionCalls).toEqual([{ method: 'open', threadId: 'waiting' }]));
  expect(enter.defaultPrevented).toBe(true);
  expect(view.slot.inspection.composer.submits).toEqual([]);
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test('Escape dismisses choices and restores ordinary Enter behaviour', async () => {
  const view = await render();
  await view.command({ action: 'attention' });
  fireEvent.keyDown(document, { key: 'Escape' });
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  fireEvent(document, enter);
  expect(enter.defaultPrevented).toBe(false);
  expect(view.slot.inspection.sidebarActionCalls).toEqual([]);
  expect(view.slot.inspection.composer.focusCount).toBe(1);
});

test('returning to the composer leaves Enter and arrow keys available to BB', async () => {
  const view = await render();
  await view.command({ action: 'attention' });
  const textarea = document.createElement('textarea');
  document.body.append(textarea);
  textarea.focus();
  try {
    for (const key of ['Enter', 'ArrowDown']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      fireEvent(textarea, event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(view.slot.inspection.sidebarActionCalls).toEqual([]);
  } finally { textarea.remove(); }
});

test('routine success stays compact while help expands the card', async () => {
  const view = await render();
  await view.command({ action: 'new' });
  expect(view.slot.getByRole('button', { name: 'Voice' }).getAttribute('aria-expanded')).toBe('false');
  expect(view.slot.getByRole('status').textContent).toMatch(/Draft ready/);
  await view.command({ action: 'help' });
  expect(view.slot.getByRole('button', { name: 'Voice' }).getAttribute('aria-expanded')).toBe('true');
});

test('a stale match cannot act on a different thread', async () => {
  const view = await render();
  const current = await view.command({ action: 'list', kind: 'thread' });
  if (!current.context) throw new Error('No voice context');
  const reply = await view.command({ action: 'select', kind: 'thread', id: 'waiting', context: current.context.replace('t1:p1', 'other-thread:p1') });
  expect(reply.ok).toBe(false);
  expect(reply.message).toMatch(/selected thread changed/);
  expect(view.slot.inspection.sidebarActionCalls).toEqual([]);
});

test('finished means unread successful results rather than every idle thread', async () => {
  const view = await render();
  await view.command({ action: 'finished' });
  await view.command({ action: 'choose', number: 1 });
  expect(view.slot.inspection.sidebarActionCalls).toEqual([{ method: 'open', threadId: 'done' }]);
});

test('unfocused windows do not claim or execute voice commands', async () => {
  const view = await render();
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  await view.slot.behavior.emitRealtime('command', { requestId: 'background', command: { action: 'new' } });
  expect(view.slot.inspection.rpcCalls).toEqual([]);
  expect(view.slot.inspection.sidebarActionCalls).toEqual([]);
});

test('model selection uses the visible composer and its machine without sending a message', async () => {
  const view = await render();
  const current = await view.command({ action: 'list', kind: 'model' });
  if (!current.context) throw new Error('No voice context');
  const reply = await view.command({ action: 'select', kind: 'model', id: 'new-model', context: current.context });
  expect(reply.ok).toBe(true);
  expect(view.slot.inspection.sdkCalls).toContainEqual({ method: 'providers.models', args: [{ providerId: 'codex', hostId: 'h1' }] });
  expect(view.slot.inspection.composer.selections).toEqual([{ model: 'new-model' }]);
  expect(view.slot.inspection.composer.submits).toEqual([]);
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test('project choices open a draft without moving the existing thread', async () => {
  const view = await render();
  const list = await view.command({ action: 'list', kind: 'project' });
  if (!list.context || !list.candidates) throw new Error('Missing project list');
  await view.command({ action: 'choices', kind: 'project', context: list.context, options: list.candidates, message: 'Choose a project' });
  await view.command({ action: 'choose', number: 1 });
  expect(view.slot.inspection.sidebarActionCalls).toEqual([{ method: 'openNewThread', options: { projectId: 'p1', focusPrompt: true } }]);
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('voice feedback retains the heard target alongside the result', async () => {
  const view = await render();
  await view.command({ action: 'notice', message: 'Heard thread target: access thread' });
  await view.command({ action: 'new' });
  fireEvent.click(view.slot.getByRole('button', { name: 'Voice' }));
  expect(view.slot.getByText('Heard thread target: access thread')).toBeTruthy();
  expect(view.slot.getAllByText(/Draft ready/).length).toBeGreaterThan(0);
});
