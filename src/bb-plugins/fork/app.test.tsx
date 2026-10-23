// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot, type CapturedPluginApp, type RenderedSlot } from '@get-bb/plugin-sdk/testing/app';

let slot: RenderedSlot | undefined;
let copied: string[] = [];
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
beforeEach(() => {
  localStorage.clear();
  copied = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => { copied.push(text); } },
  });
});
afterEach(() => { slot?.lifecycle.unmount(); slot = undefined; });

interface Call { method: string; args: unknown }
interface Command { id: string; defaultShortcut?: unknown; run(context: { threadId: string | null }): unknown }

const models = {
  modelLoadError: null,
  models: [
    { model: 'opus', displayName: 'Opus', defaultReasoningEffort: 'high', isDefault: true,
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] },
    { model: 'fable', displayName: 'Fable', defaultReasoningEffort: 'medium', isDefault: false,
      supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'max' }] },
  ],
};

function fakeSdk(calls: Call[], fork: (args: unknown) => Promise<{ id: string; title: string | null }> = async () => ({ id: 'fork1', title: '(1) Plan' })) {
  const record = <T,>(method: string, result: (args: unknown) => Promise<T>) =>
    async (args: unknown) => { calls.push({ method, args }); return result(args); };
  return {
    threads: {
      fork: record('fork', fork),
      open: record('open', async () => ({})),
      update: record('update', async () => ({})),
      send: record('send', async () => ({})),
      get: record('get', async () => ({ id: 'src', environmentId: 'env1', providerId: 'claude-code' })),
    },
    environments: { get: record('environments.get', async () => ({ id: 'env1', hostId: 'host1' })) },
    providers: { models: record('models', async () => models) },
  };
}

async function load(sdk: ReturnType<typeof fakeSdk>, openThreadPanel: (options: unknown) => boolean = () => true) {
  const app = await loadPluginApp(() => import('./app.tsx'));
  slot = renderSlot(app.appOverlays[0]!, {}, { sdk: sdk as never, openThreadPanel });
  return app;
}

const command = (app: CapturedPluginApp, id: string) =>
  (app as unknown as { commandPaletteActions: Command[] }).commandPaletteActions.find(c => c.id === id)!;

function threadAction(app: CapturedPluginApp, sdk: ReturnType<typeof fakeSdk>, opened: unknown[] = []) {
  const registration = app.threadActions.find(action => action.id === 'fork')!;
  const navigate = { openThreadPanel: (options: unknown) => { opened.push(options); return true; } };
  return registration.item({ thread: { id: 'src' } as never, data: undefined, sdk: sdk as never, navigate: navigate as never })!;
}

async function openMenu(app: CapturedPluginApp) {
  await act(async () => { await command(app, 'menu').run({ threadId: 'src' }); });
  return screen.getByRole('dialog', { name: 'Fork thread' });
}
const press = (key: string) => act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key }); });
const forkCalls = (calls: Call[]) => calls.filter(call => call.method !== 'get' && call.method !== 'models');

test('Alt+B opens the menu with Switch to fork focused, and Enter switches the pane to the fork', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  expect(command(app, 'menu').defaultShortcut).toMatchObject({ key: 'b', alt: true, mod: false, shift: false });
  await openMenu(app);
  expect(document.activeElement?.textContent).toContain('Switch to fork');
  expect(calls).toEqual([]);
  await act(async () => { (document.activeElement as HTMLButtonElement).click(); });
  expect(calls).toEqual([
    { method: 'fork', args: { sourceThreadId: 'src' } },
    { method: 'open', args: { threadId: 'fork1', split: 'replace', file: null } },
  ]);
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Now in fork (1) Plan. Original kept in the sidebar.'));
});

test.each([
  ['|', 'right'], ['ArrowRight', 'right'], ['ArrowLeft', 'left'], ['-', 'down'], ['ArrowDown', 'down'], ['ArrowUp', 'top'],
])('%s splits %s', async (key, split) => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  await openMenu(app);
  await press(key);
  expect(calls).toEqual([
    { method: 'fork', args: { sourceThreadId: 'src' } },
    { method: 'open', args: { threadId: 'fork1', split, file: null } },
  ]);
});

const panelOpens = () => slot!.inspection.navigateCalls.filter(call => call.method === 'openThreadPanel').map(call => call.options);

test('s opens the fork in a side panel tab beside this thread', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  await openMenu(app);
  await press('s');
  expect(calls.map(call => call.method)).toEqual(['fork']);
  expect(panelOpens()).toEqual([{ actionId: 'fork', title: '(1) Plan', params: { threadId: 'fork1' } }]);
  expect(screen.queryByRole('status')).toBeNull();
});

test('s says where the fork went when BB has no side panel', async () => {
  const app = await load(fakeSdk([]), () => false);
  await openMenu(app);
  await press('s');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('No side panel here. The fork is in the sidebar.'));
});

test('the panel tab shows the fork conversation, and a tab without one says so', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const panel = app.threadPanelActions.find(action => action.id === 'fork')!;
  const tab = renderSlot(panel, { threadId: 'src', params: { threadId: 'fork1' } });
  expect(screen.queryByRole('alert')).toBeNull();
  tab.lifecycle.unmount();
  const broken = renderSlot(panel, { threadId: 'src', params: null });
  expect(screen.getByRole('alert').textContent).toBe('This fork tab has lost its thread.');
  broken.lifecycle.unmount();
});

test('the panel launcher forks this thread into a new tab', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  const opened: unknown[] = [];
  const panel = app.threadPanelActions.find(action => action.id === 'fork')!;
  await act(async () => { await panel.run!({ threadId: 'src', openPanel: options => { opened.push(options); return true; } }); });
  expect(calls.map(call => call.method)).toEqual(['fork']);
  expect(opened).toEqual([{ title: '(1) Plan', params: { threadId: 'fork1' } }]);
});

test('a count and w make that many worktree forks', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  await openMenu(app);
  await press('3');
  await press('w');
  expect(screen.getByRole('dialog').querySelector('header')?.textContent).toContain('×3 · new worktree');
  await press('s');
  const environment = { type: 'host', hostId: 'host1', workspace: { type: 'managed-worktree', baseBranch: { kind: 'default' } } };
  expect(forkCalls(calls).filter(call => call.method !== 'environments.get')).toEqual(
    Array.from({ length: 3 }, () => ({ method: 'fork', args: { sourceThreadId: 'src', environment } })));
});

test('switching with a count shows the first fork and keeps the rest in the sidebar', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  await openMenu(app);
  await press('2');
  await act(async () => { (document.activeElement as HTMLButtonElement).click(); });
  expect(calls.map(call => call.method)).toEqual(['fork', 'open', 'fork']);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('1 more in the sidebar.'));
});

test('m picks a model and effort that the fork keeps before its first prompt', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  await openMenu(app);
  await press('m');
  await waitFor(() => expect(screen.getByText('Fable')).toBeTruthy());
  expect(calls).toContainEqual({ method: 'models', args: { providerId: 'claude-code', environmentId: 'env1' } });
  await press('2');
  await press('2');
  expect(screen.getByRole('dialog').querySelector('header')?.textContent).toContain('Fable · max');
  await press('p');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Try the other approach' } });
  await press('Enter');
  await press('|');
  expect(forkCalls(calls)).toEqual([
    { method: 'fork', args: { sourceThreadId: 'src' } },
    { method: 'update', args: { threadId: 'fork1', model: 'fable', reasoningLevel: 'max' } },
    { method: 'send', args: { threadId: 'fork1', mode: 'start', input: [{ type: 'text', text: 'Try the other approach', mentions: [] }] } },
    { method: 'open', args: { threadId: 'fork1', split: 'right', file: null } },
  ]);
});

test('Enter on the effort step takes the model default', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  await openMenu(app);
  await press('m');
  await waitFor(() => expect(screen.getByText('Opus')).toBeTruthy());
  await press('1');
  await act(async () => { (document.activeElement as HTMLButtonElement).click(); });
  await press('s');
  expect(forkCalls(calls)).toContainEqual({ method: 'update', args: { threadId: 'fork1', model: 'opus', reasoningLevel: 'high' } });
});

test('Escape steps back before it closes', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  const dialog = await openMenu(app);
  await press('p');
  await act(async () => { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); });
  expect(screen.getByText('Switch to fork')).toBeTruthy();
  await act(async () => { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(calls).toEqual([]);
});

test('c and y copy the fork command and thread id without forking', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  await openMenu(app);
  await press('w');
  await press('c');
  await openMenu(app);
  await press('y');
  expect(copied).toEqual(['bb thread fork src --new-environment worktree', 'src']);
  expect(calls).toEqual([]);
});

test('Fork from here opens the menu anchored on the message', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  const action = app.messageActions.find(a => a.id === 'fork-here')!;
  await act(async () => { await action.run({ threadId: 'src', message: { sourceSeqEnd: 42 } } as never); });
  expect(screen.getByRole('dialog', { name: 'Fork from this message' })).toBeTruthy();
  await press('s');
  expect(calls[0]).toEqual({ method: 'fork', args: { sourceThreadId: 'src', sourceSeqEnd: 42 } });
});

test('Alt+Shift+B repeats the last placement, worktree and count but not model or prompt', async () => {
  const calls: Call[] = [];
  const app = await load(fakeSdk(calls));
  expect(command(app, 'repeat').defaultShortcut).toMatchObject({ key: 'B', alt: true, shift: true });
  await act(async () => { await command(app, 'repeat').run({ threadId: 'src' }); });
  expect(calls.map(call => call.method)).toEqual(['fork', 'open']);
  expect(calls[1]?.args).toMatchObject({ split: 'replace' });

  await openMenu(app);
  await press('2');
  await press('p');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'once' } });
  await press('Enter');
  await press('-');
  calls.length = 0;
  await act(async () => { await command(app, 'repeat').run({ threadId: 'src' }); });
  expect(calls.map(call => call.method)).toEqual(['fork', 'open', 'fork', 'open']);
  expect(calls[1]?.args).toMatchObject({ split: 'down' });
});

test('the thread menu offers each placement and Side panel opens a panel tab', async () => {
  const calls: Call[] = [];
  const sdk = fakeSdk(calls);
  const app = await load(sdk);
  const opened: unknown[] = [];
  const action = threadAction(app, sdk, opened);
  expect(action.choices?.items.map(item => item.id)).toEqual(['switch', 'right', 'down', 'sidebar', 'worktree']);
  await act(async () => { await action.run({ value: 'sidebar', requestRename: () => {} }); });
  expect(calls.map(call => call.method)).toEqual(['fork']);
  expect(opened).toEqual([{ actionId: 'fork', title: '(1) Plan', params: { threadId: 'fork1' } }]);
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
  await act(() => command(app, 'repeat').run({ threadId: 'src' }) as Promise<void>);
  expect(screen.getByRole('alert').textContent).toBe('Fork failed: provider cannot fork mid-turn');
});

test('a second press while forking does not fork twice', async () => {
  const calls: Call[] = [];
  let finish!: (value: { id: string; title: string | null }) => void;
  const app = await load(fakeSdk(calls, () => new Promise(resolve => { finish = resolve; })));
  const first = command(app, 'repeat').run({ threadId: 'src' }) as Promise<void>;
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Forking…'));
  await command(app, 'repeat').run({ threadId: 'src' });
  await act(async () => { finish({ id: 'fork1', title: null }); await first; });
  expect(calls.map(call => call.method)).toEqual(['fork', 'open']);
  expect(screen.getByRole('status').textContent).toBe('Now in the fork. Original kept in the sidebar.');
});

test('the menu opens centred near the top, not under the focused composer', async () => {
  const composer = document.body.appendChild(document.createElement('textarea'));
  composer.getBoundingClientRect = () => ({ right: 900, bottom: 700 }) as DOMRect;
  composer.focus();
  const app = await load(fakeSdk([]));
  const dialog = await openMenu(app);
  expect(dialog.style.top).toBe(`${Math.round(window.innerHeight * 0.15)}px`);
  expect(dialog.style.left).toBe(`${(window.innerWidth - 380) / 2}px`);
  await press('Escape');
  await act(async () => { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); });
  expect(document.activeElement).toBe(composer);
  composer.remove();
});
