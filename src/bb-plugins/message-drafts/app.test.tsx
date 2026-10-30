// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import { DraftEditor } from './app.tsx';
import type { rpcContract } from './contracts.ts';
afterEach(() => { cleanup(); localStorage.clear(); });
test('typing autosaves and undo restores the previous message', async () => {
  let saved = { text: 'Hello Alex', revision: 1 };
  const slot = renderSlot<Record<string, never>, typeof rpcContract>({ component: () => <DraftEditor threadId="thread-one" /> }, {}, { rpc: {
    read: () => saved,
    write: input => { saved = { text: input.text, revision: input.revision + 1 }; return { ok: true, revision: saved.revision }; },
  } });
  await waitFor(() => expect(slot.getByRole('textbox').getAttribute('disabled')).toBeNull());
  fireEvent.change(slot.getByRole('textbox'), { target: { value: 'Hello Alex, thanks!' } });
  await waitFor(() => expect(saved.text).toBe('Hello Alex, thanks!'), { timeout: 2500 });
  fireEvent.click(slot.getByRole('button', { name: 'Undo' }));
  expect((slot.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Hello Alex');
});
test('a conflicting agent write keeps local edits until the user loads the saved version', async () => {
  let saved = { text: 'Hello Alex', revision: 1 };
  const slot = renderSlot<Record<string, never>, typeof rpcContract>({ component: () => <DraftEditor threadId="thread-one" /> }, {}, { rpc: {
    read: () => saved,
    write: () => { saved = { text: 'Agent revision', revision: 2 }; return { ok: false, revision: 2, error: 'Draft changed. Read it before writing again.' }; },
  } });
  await waitFor(() => expect(slot.getByRole('textbox').getAttribute('disabled')).toBeNull());
  fireEvent.change(slot.getByRole('textbox'), { target: { value: 'My manual edit' } });
  await slot.findByRole('alert', {}, { timeout: 2500 });
  expect((slot.getByRole('textbox') as HTMLTextAreaElement).value).toBe('My manual edit');
  fireEvent.click(slot.getByRole('button', { name: 'Load saved version' }));
  expect((slot.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Agent revision');
});

test('the reply button opens the draft panel without changing its text', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const registration = app.messageDirectives.find(item => item.id === 'message-draft');
  if (!registration) throw new Error('Missing draft directive');
  const opened: unknown[] = [];
  const slot = renderSlot(registration, {
    attributes: {}, source: '::message-draft',
    message: { id: 'message-one', threadId: 'thread-one', turnId: 'turn-one', projectId: 'project-one' }, openWorkspaceFile: null,
  }, { openThreadPanel: options => { opened.push(options); return true; } });
  fireEvent.click(slot.getByRole('button', { name: 'Open message draft' }));
  expect(opened).toEqual([{ actionId: 'draft' }]);
});
