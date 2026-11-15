// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderSlot, type RenderedSlot } from '@get-bb/plugin-sdk/testing/app';
import { GitPopover } from './popover.tsx';
import type { OpRequest, OpState, Repo, rpcContract } from './contracts.ts';
import { receiveOp } from './repo-store.ts';

const root = '/trees/example';
const repo: Repo = {
  kind: 'repo', name: 'example', branch: { head: 'main', oid: 'abcdef1234567890abcdef1234567890abcdef12', upstream: 'origin/main', ahead: 0, behind: 0 },
  operation: null, remotes: ['origin'], stashes: [], hidden: 0, commits: [],
  changes: [{ path: 'README.md', origPath: null, area: 'unstaged', code: 'M', added: 1, removed: 0 }],
};
const fetching: OpState = { id: 'op_fetch', request: { kind: 'fetch' }, origin: 'auto', startedAt: 1, status: 'running', progress: null };
const review = { head: 'head', index: 'index', count: 1, blocked: null, draftKey: 'example' };

let slot: RenderedSlot | undefined;
beforeEach(() => {
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  localStorage.clear();
});
const { waitFor } = vi;
const key = (target: HTMLElement, value: string) => act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); });

afterEach(() => { slot?.lifecycle.unmount(); slot = undefined; vi.unstubAllGlobals(); });

/** The server is running a fetch the pop-up has not heard about: every other request is refused. */
function popover() {
  const threadId = crypto.randomUUID();
  const run = vi.fn(({ request }: { request: OpRequest }) => ({ op: request.kind === 'fetch' ? { ...fetching, request } : fetching }));
  slot = renderSlot<Parameters<typeof GitPopover>[0], Pick<typeof rpcContract, 'watch' | 'unwatch' | 'run' | 'review'>>({ component: GitPopover },
    { threadId, anchor: null, instant: true, onClose: () => {} },
    { rpc: {
      watch: () => ({ root, selected: false, snapshot: repo, op: null, fetch: { lastSucceededAt: null, failure: null } }),
      unwatch: () => ({}),
      run,
      review: () => review,
    } });
  return { view: slot, run, threadId };
}
const row = (view: RenderedSlot) => view.baseElement.querySelector<HTMLElement>('[data-file-path="README.md"]')!;

it('names the running operation when an action is refused, and clears once it finishes', async () => {
  const { view, threadId } = popover();
  await waitFor(() => expect(row(view)).toBeTruthy());
  act(() => view.getByRole('button', { name: 'Stage README.md' }).click());
  await view.findByText('Fetch is running. Try again when it finishes.');
  expect(view.getByRole('button', { name: /Cancel fetch/ })).toBeTruthy();

  act(() => receiveOp({ threadIds: [threadId], root, op: { ...fetching, status: 'succeeded', summary: 'Fetched', finishedAt: 2 }, fetch: { lastSucceededAt: 2, failure: null } }));
  await waitFor(() => expect(view.queryByText('Fetch is running. Try again when it finishes.')).toBeNull());
});

it('moves focus into the commit form, so a typed message never reaches row shortcuts', async () => {
  const { view, run } = popover();
  await waitFor(() => expect(row(view)).toBeTruthy());
  row(view).focus();
  key(row(view), 'c');
  const textarea = await view.findByRole('textbox', { name: /Commit subject/ });
  await waitFor(() => expect(view.baseElement.ownerDocument.activeElement).toBe(textarea));
  key(textarea, 'd');
  key(textarea, 'd');
  expect(run.mock.calls.filter(([input]) => input.request.kind === 'discard')).toHaveLength(0);

  key(textarea, 'Escape');
  expect(view.baseElement.ownerDocument.activeElement).toBe(view.getByRole('button', { name: 'Commit staged changes' }));
});

it('shows a sent request as starting until the server replies, so repeat clicks and keys send nothing', async () => {
  const threadId = crypto.randomUUID();
  let reply: (value: { op: OpState }) => void = () => {};
  const run = vi.fn(({ origin }: { origin: 'user' | 'auto' }) => origin === 'auto' ? { op: null } : new Promise<{ op: OpState }>(resolve => { reply = resolve; }));
  slot = renderSlot<Parameters<typeof GitPopover>[0], Pick<typeof rpcContract, 'watch' | 'unwatch' | 'run'>>({ component: GitPopover },
    { threadId, anchor: null, instant: true, onClose: () => {} },
    { rpc: {
      watch: () => ({ root, selected: false, snapshot: repo, op: null, fetch: { lastSucceededAt: null, failure: null } }),
      unwatch: () => ({}),
      run,
    } });
  const view = slot;
  const userRuns = () => run.mock.calls.filter(([input]) => input.origin === 'user').length;
  await waitFor(() => expect(row(view)).toBeTruthy());
  act(() => view.getByRole('button', { name: 'Fetch from the remote (f)' }).click());
  const starting = await view.findByRole('button', { name: 'Starting fetch' });
  expect((starting as HTMLButtonElement).disabled).toBe(true);
  act(() => starting.click());
  key(row(view), 'f');
  expect(userRuns()).toBe(1);
  expect((view.getByRole('button', { name: 'Stage README.md' }) as HTMLButtonElement).disabled).toBe(true);

  await act(async () => { reply({ op: { ...fetching, id: 'op_user', origin: 'user' } }); });
  const cancel = await view.findByRole('button', { name: 'Cancel fetch' });
  expect((cancel as HTMLButtonElement).disabled).toBe(false);
});
