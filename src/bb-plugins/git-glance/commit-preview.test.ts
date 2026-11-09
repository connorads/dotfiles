// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderSlot, type RenderedSlot } from '@get-bb/plugin-sdk/testing/app';
import { CommitPreview } from './commit-preview.tsx';
import type { CommitLookup, rpcContract, Snapshot } from './contracts.ts';

const sha = 'abcdef1234567890abcdef1234567890abcdef1234';
let slot: RenderedSlot | undefined;
beforeEach(() => {
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { slot?.lifecycle.unmount(); slot = undefined; vi.unstubAllGlobals(); });

function preview(result: CommitLookup | Promise<CommitLookup>) {
  let root = '/selected';
  const snapshot: Snapshot = { kind: 'repo', name: 'Example', branch: { head: 'main', oid: sha, upstream: null, ahead: 0, behind: 0 },
    operation: null, remotes: [], stashes: [], changes: [], hidden: 0, commits: [] };
  const open = vi.fn(({ path }: { path: string }) => { root = path; return {}; });
  const commit = vi.fn(() => ({ sha, parents: [], subject: 'Example commit', body: '', author: 'Test', authorEmail: 'test@example.com',
    authoredAt: 1, committer: 'Test', committedAt: 1, files: [], hidden: 0 }));
  slot = renderSlot<Parameters<typeof CommitPreview>[0], Pick<typeof rpcContract, 'watch' | 'unwatch' | 'findCommit' | 'openCheckout' | 'commit'>>({ component: CommitPreview }, {
    threadId: crypto.randomUUID(), sha: sha.slice(0, 7), onClose: () => {}, onRepository: () => {},
  }, { rpc: {
    watch: () => ({ root, selected: root !== '/selected', snapshot, op: null, fetch: { lastSucceededAt: null, failure: null } }),
    unwatch: () => ({}),
    findCommit: async () => ({ ...await result, hostId: 'host' }),
    openCheckout: open,
    commit,
  } });
  return { view: slot, open, commit };
}

it('opens a unique match with its full hash and shows the resolved repository', async () => {
  const { view, open, commit } = preview({ matches: [{ root: '/trees/example', sha }], unchecked: 0 });
  await view.findByText('Example commit');
  expect(open).toHaveBeenCalledOnce();
  expect(open.mock.calls[0]?.[0]).toMatchObject({ path: '/trees/example' });
  expect(commit.mock.calls[0]).toBeDefined();
  expect(view.getByText('/trees/example')).toBeTruthy();
  expect(view.inspection.rpcCalls.find(call => call.method === 'commit')?.input).toMatchObject({ sha });
});

it('reads a match in the current repository without selecting it again', async () => {
  const { view, open } = preview({ matches: [{ root: '/selected', sha }], unchecked: 0 });
  await view.findByText('Example commit');
  expect(open).not.toHaveBeenCalled();
});

it('requires an explicit choice for duplicate matches', async () => {
  const { view, open } = preview({ matches: [{ root: '/trees/alpha', sha }, { root: '/trees/beta', sha }], unchecked: 0 });
  const button = await view.findByRole('button', { name: /\/trees\/beta/ });
  expect(open).not.toHaveBeenCalled();
  button.click();
  await view.findByText('Example commit');
  expect(open.mock.calls[0]?.[0]).toMatchObject({ path: '/trees/beta' });
});

it('keeps a sole match selectable when coverage is incomplete', async () => {
  const { view, open } = preview({ matches: [{ root: '/trees/alpha', sha }], unchecked: 1 });
  await view.findByText('Some repositories could not be checked. Results may be incomplete.');
  expect(open).not.toHaveBeenCalled();
  expect(view.getByRole('button', { name: /\/trees\/alpha/ })).toBeTruthy();
});

it('shows a useful missing-commit message without reading the wrong repository', async () => {
  const { view, open, commit } = preview({ matches: [], unchecked: 0 });
  await view.findByText(/Commit not found in known repositories/);
  expect(open).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it('ignores a lookup that finishes after the preview closes', async () => {
  let finish = (_value: CommitLookup) => {};
  const result = new Promise<CommitLookup>(resolve => { finish = resolve; });
  const { view, open } = preview(result);
  view.lifecycle.unmount(); slot = undefined;
  finish({ matches: [{ root: '/trees/alpha', sha }], unchecked: 0 });
  await result;
  await Promise.resolve();
  expect(open).not.toHaveBeenCalled();
});
