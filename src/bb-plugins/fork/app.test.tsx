// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot, type CapturedPluginApp, type RenderedSlot } from '@get-bb/plugin-sdk/testing/app';

let slot: RenderedSlot | undefined;
afterEach(() => { slot?.lifecycle.unmount(); slot = undefined; });

interface Call { method: string; args: unknown }
interface Command { id: string; defaultShortcut?: unknown; run(context: { threadId: string | null }): unknown }

function fakeSdk(calls: Call[], fork: (args: unknown) => Promise<{ id: string }> = async () => ({ id: 'fork1' })) {
  const record = <T,>(method: string, result: (args: unknown) => Promise<T>) =>
    async (args: unknown) => { calls.push({ method, args }); return result(args); };
  return {
    threads: {
      fork: record('fork', fork),
      open: record('open', async () => ({})),
      get: record('get', async () => ({ id: 'src', environmentId: 'env1' })),
    },
    environments: { get: record('environments.get', async () => ({ id: 'env1', hostId: 'host1' })) },
  };
}

async function load(sdk: ReturnType<typeof fakeSdk>) {
  const app = await loadPluginApp(() => import('./app.tsx'));
  slot = renderSlot(app.appOverlays[0]!, {}, { sdk: sdk as never });
  return app;
}

const command = (app: CapturedPluginApp) =>
  (app as unknown as { commandPaletteActions: Command[] }).commandPaletteActions.find(c => c.id === 'split')!;

function threadAction(app: CapturedPluginApp, sdk: ReturnType<typeof fakeSdk>) {
  const registration = app.threadActions.find(action => action.id === 'fork')!;
  return registration.item({ thread: { id: 'src' } as never, data: undefined, sdk: sdk as never, navigate: {} as never })!;
}

test('the shortcut forks the thread tip into a right split', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  expect(command(app).defaultShortcut).toMatchObject({ key: 'b', alt: true, mod: false, shift: false });
  await act(() => command(app).run({ threadId: 'src' }) as Promise<void>);
  expect(calls).toEqual([
    { method: 'fork', args: { sourceThreadId: 'src' } },
    { method: 'open', args: { threadId: 'fork1', split: 'right', file: null } },
  ]);
});

test('Fork from here anchors the fork on the message', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  const action = app.messageActions.find(a => a.id === 'fork-here')!;
  await act(async () => {
    await action.run({ threadId: 'src', message: { sourceSeqEnd: 42 } } as never);
  });
  expect(calls[0]).toEqual({ method: 'fork', args: { sourceThreadId: 'src', sourceSeqEnd: 42 } });
});

test('the menu offers each placement and Sidebar only opens nothing', async () => {
  const calls: Call[] = [];
  const sdk = fakeSdk(calls);
  const app = await load(sdk);
  const action = threadAction(app, sdk);
  expect(action.choices?.items.map(item => item.id)).toEqual(['right', 'down', 'sidebar', 'worktree']);
  await act(async () => { await action.run({ value: 'sidebar', requestRename: () => {} }); });
  expect(calls.map(call => call.method)).toEqual(['fork']);
});

test('the worktree choice branches a fresh worktree on the source machine', async () => {
  const calls: Call[] = [];
  const sdk = fakeSdk(calls);
  const app = await load(sdk);
  await act(async () => { await threadAction(app, sdk).run({ value: 'worktree', requestRename: () => {} }); });
  expect(calls).toEqual([
    { method: 'get', args: { threadId: 'src' } },
    { method: 'environments.get', args: { environmentId: 'env1' } },
    { method: 'fork', args: {
      sourceThreadId: 'src',
      environment: { type: 'host', hostId: 'host1', workspace: { type: 'managed-worktree', baseBranch: { kind: 'default' } } },
    } },
    { method: 'open', args: { threadId: 'fork1', split: 'right', file: null } },
  ]);
});

test('a failed fork shows why', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls, async () => { throw new Error('provider cannot fork mid-turn'); }));
  await act(() => command(app).run({ threadId: 'src' }) as Promise<void>);
  expect(screen.getByRole('alert').textContent).toBe('Fork failed: provider cannot fork mid-turn');
});

test('a second press while forking does not fork twice', async () => {
  const calls: Call[] = [];
  let finish!: (value: { id: string }) => void;
  const app = await load(fakeSdk(calls, () => new Promise(resolve => { finish = resolve; })));
  const first = command(app).run({ threadId: 'src' }) as Promise<void>;
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Forking…'));
  await command(app).run({ threadId: 'src' });
  await act(async () => { finish({ id: 'fork1' }); await first; });
  expect(calls.map(call => call.method)).toEqual(['fork', 'open']);
  expect(screen.queryByRole('status')).toBeNull();
});
