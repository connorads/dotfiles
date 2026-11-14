// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot, type RenderedSlot } from '@get-bb/plugin-sdk/testing/app';

let slot: RenderedSlot | undefined;
afterEach(() => { slot?.lifecycle.unmount(); slot = undefined; document.body.innerHTML = ''; });

const requested = (seq: number, text: string) =>
  ({ seq, type: 'client/turn/requested', data: { initiator: 'user', input: [{ type: 'text', text, mentions: [] }] } });

// Like BB: at most 100 rows per page, paged with afterSeq.
const PAGE_LIMIT = 100;
const history = [requested(4, 'first prompt'), ...Array.from({ length: 150 }, (_, i) => requested(10 + i, `filler ${i}`)), requested(900, 'second prompt')];
async function listEvents(args: { afterSeq?: string; limit?: string }) {
  if (Number(args.limit) > PAGE_LIMIT) throw new Error('HTTP 400: Thread event limit cannot exceed 100');
  return history.filter(row => row.seq > Number(args.afterSeq ?? -1)).slice(0, Number(args.limit ?? PAGE_LIMIT));
}

type Outcome = (args: unknown) => Promise<unknown>;

async function render(list: typeof listEvents = listEvents, outcomes: Partial<Record<'editMessage' | 'fork' | 'open', Outcome>> = {}) {
  const calls: { method: string; args: unknown }[] = [];
  const app = await loadPluginApp(() => import('./app.tsx'));
  const recorded = (method: 'editMessage' | 'fork' | 'open', fallback: unknown) => async (args: unknown) => {
    calls.push({ method, args });
    return outcomes[method] ? outcomes[method](args) : fallback;
  };
  slot = renderSlot(app.appOverlays[0]!, {}, {
    context: { threadId: 't1', projectId: 'p1' },
    sdk: { threads: {
      events: { list },
      editMessage: recorded('editMessage', { ok: true, operationId: 'op', requestSequence: 9 }),
      fork: recorded('fork', { id: 'fork1' }),
      open: recorded('open', {}),
    } } as never,
  });
  // An idle, empty composer that blurs itself on Escape, like BB's.
  document.body.insertAdjacentHTML('beforeend', '<form data-promptbox><div contenteditable="true" tabindex="0"></div></form>');
  const editor = document.querySelector<HTMLElement>('[contenteditable]')!;
  editor.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); editor.blur(); } });
  editor.focus();
  return { calls, editor };
}

const key = (target: Element, k: string, init: KeyboardEventInit = {}) =>
  act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })); });

async function openPicker(editor: HTMLElement, ready = 'second prompt') {
  await key(editor, 'Escape');
  await key(document.body, 'Escape');
  return waitFor(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Rewind"]');
    if (!dialog?.textContent?.includes(ready)) throw new Error('picker not ready');
    return dialog;
  });
}

// Each event load waits until the test resolves it with the rows it should return.
function gatedEvents() {
  const pending: ((rows: typeof history) => void)[] = [];
  const list = () => new Promise<typeof history>(resolve => { pending.push(resolve); });
  return { list: list as unknown as typeof listEvents, pending };
}

const selected = () => document.querySelector('[role="option"][aria-selected="true"]')?.textContent;

test('double Escape opens the picker on the latest prompt', async () => {
  const { editor } = await render();
  await openPicker(editor);
  expect(selected()).toContain('second prompt');
});

test('Enter edits the selected prompt and Enter again rewinds the thread', async () => {
  const { calls, editor } = await render();
  await openPicker(editor);
  await key(document.body, 'Home');
  expect(selected()).toContain('first prompt');
  await key(document.body, 'Enter');
  const box = await waitFor(() => document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!);
  expect(box.value).toBe('first prompt');
  fireEvent.change(box, { target: { value: 'better prompt' } });
  await key(box, 'Enter');
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]).toMatchObject({ method: 'editMessage', args: {
    threadId: 't1', expectedRequestSequence: 4,
    input: [{ type: 'text', text: 'better prompt', mentions: [] }],
  } });
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
});

test('f forks before the selected prompt and opens the fork', async () => {
  const { calls, editor } = await render();
  await openPicker(editor);
  await key(document.body, 'f');
  await waitFor(() => expect(calls.map(c => c.method)).toEqual(['fork', 'open']));
  expect(calls[0]!.args).toMatchObject({ sourceThreadId: 't1', sourceSeqEnd: 900 });
  expect(calls[1]!.args).toMatchObject({ threadId: 'fork1' });
});

test('Escape closes the picker without changes', async () => {
  const { calls, editor } = await render();
  await openPicker(editor);
  await key(document.body, 'Escape');
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(calls).toEqual([]);
});

test('reopening shows Loading, not the previous list, and ignores f until the load finishes', async () => {
  const { list, pending } = gatedEvents();
  const { calls, editor } = await render(list);
  const opened = openPicker(editor);
  await waitFor(() => expect(pending).toHaveLength(1));
  await act(async () => pending[0]!([requested(900, 'second prompt')]));
  await opened;
  await key(document.body, 'Escape');
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  editor.focus();
  await openPicker(editor, 'Loading…');
  expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain('second prompt');
  await key(document.body, 'f');
  expect(calls).toEqual([]);
});

test('a late earlier load does not replace a newer one', async () => {
  const { list, pending } = gatedEvents();
  const { editor } = await render(list);
  await openPicker(editor, 'Loading…');
  await key(document.body, 'Escape');
  editor.focus();
  await openPicker(editor, 'Loading…');
  await act(async () => pending[1]!([requested(7, 'newer prompt')]));
  await act(async () => pending[0]!([requested(3, 'older prompt')]));
  await waitFor(() => expect(selected()).toContain('newer prompt'));
  expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain('older prompt');
});

test('a thread with no prompts says so instead of Loading', async () => {
  const { editor } = await render(async () => []);
  await openPicker(editor, 'No messages to rewind yet.');
  expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain('Loading…');
});


test('touch controls rewind the tapped prompt rather than the previous selection', async () => {
  const { calls, editor } = await render();
  await openPicker(editor);
  fireEvent.click(document.querySelector('[role="option"]')!);
  const box = document.querySelector('textarea')!;
  fireEvent.change(box, { target: { value: 'Changed prompt' } });
  fireEvent.click(Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Rewind')!);
  await waitFor(() => expect(calls.some(call => call.method === 'editMessage')).toBe(true));
  expect(calls.find(call => call.method === 'editMessage')?.args).toMatchObject({ expectedRequestSequence: 4, input: [{ type: 'text', text: 'Changed prompt' }] });
});

const dialog = () => document.querySelector('[role="dialog"][aria-label="Rewind"]');
const alertText = () => document.querySelector('[role="alert"]')?.textContent ?? null;
const footer = () => dialog()?.querySelector('footer')?.textContent;

test('clicking the backdrop during a pending rewind keeps the picker open', async () => {
  const { editor } = await render(listEvents, { editMessage: () => new Promise(() => {}) });
  await openPicker(editor);
  await key(document.body, 'Enter');
  const box = await waitFor(() => document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!);
  await key(box, 'Enter');
  await waitFor(() => expect(footer()).toBe('Rewinding…'));
  fireEvent.mouseDown(document.querySelector('.ck-backdrop')!);
  expect(dialog()).not.toBeNull();
});

test('a pending fork says Forking… and ignores backdrop clicks', async () => {
  const { editor } = await render(listEvents, { fork: () => new Promise(() => {}) });
  await openPicker(editor);
  await key(document.body, 'f');
  await waitFor(() => expect(footer()).toBe('Forking…'));
  fireEvent.mouseDown(document.querySelector('.ck-backdrop')!);
  expect(dialog()).not.toBeNull();
});

test('retrying after the fork could not be opened opens the same fork instead of forking again', async () => {
  let opens = 0;
  const { calls, editor } = await render(listEvents, { open: async () => { if (++opens === 1) throw new Error('Could not open thread fork1.'); return {}; } });
  await openPicker(editor);
  await key(document.body, 'f');
  await waitFor(() => expect(alertText()).toBe('The fork exists but did not open: Could not open thread fork1. Fork again to open it.'));
  await key(document.body, 'f');
  await waitFor(() => expect(dialog()).toBeNull());
  expect(calls.map(c => c.method)).toEqual(['fork', 'open', 'open']);
  expect(calls[2]!.args).toMatchObject({ threadId: 'fork1' });
});

test('forking a different prompt after an open failure creates a new fork', async () => {
  let opens = 0;
  const { calls, editor } = await render(listEvents, { open: async () => { if (++opens === 1) throw new Error('Could not open thread fork1.'); return {}; } });
  await openPicker(editor);
  await key(document.body, 'f');
  await waitFor(() => expect(alertText()).not.toBeNull());
  await key(document.body, 'Home');
  await key(document.body, 'f');
  await waitFor(() => expect(dialog()).toBeNull());
  expect(calls.map(c => c.method)).toEqual(['fork', 'open', 'fork', 'open']);
  expect(calls[2]!.args).toMatchObject({ sourceSeqEnd: 4 });
});

test('going back to the list after a failed rewind clears the rewind error', async () => {
  const { editor } = await render(listEvents, { editMessage: async () => { throw new Error('Thread is running.'); } });
  await openPicker(editor);
  await key(document.body, 'Enter');
  const box = await waitFor(() => document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!);
  await key(box, 'Enter');
  await waitFor(() => expect(alertText()).toBe('Thread is running.'));
  await key(document.querySelector('[role="dialog"] textarea')!, 'Escape');
  expect(alertText()).toBeNull();
});

test('a failed load shows the reason and Enter tries again', async () => {
  let attempts = 0;
  const { editor } = await render(async args => { if (++attempts === 1) throw new Error('HTTP 500: Thread event store unavailable'); return listEvents(args); });
  await openPicker(editor, 'HTTP 500');
  expect(alertText()).toBe('HTTP 500: Thread event store unavailable');
  expect(footer()).toBe('Enter try again · Q/Esc close');
  await key(document.body, 'Enter');
  await waitFor(() => expect(selected()).toContain('second prompt'));
  expect(alertText()).toBeNull();
});
