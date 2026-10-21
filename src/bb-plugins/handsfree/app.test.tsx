// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot, type RenderedSlot, type RenderSlotOptions } from '@get-bb/plugin-sdk/testing/app';
import type { PluginSidebarThread } from '@get-bb/plugin-sdk';
import { commandSchema, type Command, type Reply } from './contracts.ts';
import type { rpcContract } from './rpc.ts';
import { makeArchives } from './archive.ts';
import { unavailableDiagnostics, type Diagnostics } from './diagnostics-contract.ts';
import { makeThreadResponse } from '@get-bb/plugin-sdk/testing';

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
let headerSlot: RenderedSlot | undefined;
beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100, height: 30 }] as unknown as DOMRectList);
  vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
});
afterEach(() => { slot?.lifecycle.unmount(); headerSlot?.lifecycle.unmount(); slot = undefined; headerSlot = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function render(archiveStatus = 'idle', duringInspect?: () => void | Promise<void>, threads?: PluginSidebarThread[], options: { diagnostics?: () => Diagnostics | Promise<Diagnostics>; nativeQuestion?: { multi?: boolean; disabled?: boolean }; composer?: RenderSlotOptions['composer']; sidebarSplitLayout?: RenderSlotOptions['sidebarSplitLayout']; sdk?: RenderSlotOptions['sdk']; settings?: RenderSlotOptions['settings'] } = {}) {
  const { diagnostics = () => unavailableDiagnostics, nativeQuestion } = options;
  const replies: Reply[] = [];
  const archived: string[] = [];
  const restored: string[] = [];
  const approvals: unknown[] = [];
  let receipts: unknown;
  const archives = makeArchives({
    get: async id => { await duringInspect?.(); return { id, title: 'Selected thread', projectId: 'p1', status: archiveStatus, archivedAt: null }; },
    children: async () => 0,
    archive: async id => { archived.push(id); return [id]; },
    unarchive: async id => { restored.push(id); },
    load: async () => receipts,
    save: async value => { receipts = structuredClone(value); },
  });
  const app = await loadPluginApp(() => import('./app.tsx'));
  const registration = app.appOverlays[0];
  if (!registration) throw new Error('Voice overlay missing');
  const VoiceComponent = registration.component;
  const wrapped = { ...registration, component: () => <>
    {nativeQuestion && <NativeQuestion {...nativeQuestion} />}
    <VoiceComponent />
  </> };
  slot = renderSlot<object, typeof rpcContract>(wrapped, {}, {
    context: { threadId: options.composer?.scope?.kind === 'new-thread' ? null : 't1', projectId: 'p1' },
    composer: { scope: { kind: 'thread', threadId: 't1' }, text: 'Unsent task', selection: { providerId: 'codex', model: 'gpt-test' }, ...options.composer },
    sidebarSplitLayout: options.sidebarSplitLayout,
    settings: options.settings,
    sidebarThreads: {
      threads: threads ?? [thread('t1'), thread('waiting', { hasPendingInteraction: true }), thread('hidden', { isHidden: true, hasPendingInteraction: true }), thread('done', { indicator: 'unread-success' })],
      projects: [{ id: 'p1', name: 'dotfiles', isPersonal: false, href: '/', settingsHref: '/' },
        { id: 'p2', name: 'kb', isPersonal: false, href: '/', settingsHref: '/' }],
    },
    rpc: {
      diagnostics,
      observed: () => ({ recorded: true }),
      archiveTarget: ({ threadId }) => archives.inspect(threadId),
      archive: ({ target, confirmed }) => archives.archive(target, confirmed),
      restore: () => archives.restore(),
      approve: input => { approvals.push(input); return { ok: true, outcome: 'completed', message: 'Allowed once: ls' }; },
      claim: () => ({ claimed: true }), complete: ({ reply }) => { replies.push(reply); return { accepted: true }; },
    },
    sdk: {
      system: { config: async () => { throw new Error('No keyboard configuration in this fixture.'); },
        executionOptions: async ({ providerId = 'codex' } = {}) => ({
          providers: ['codex', 'claude-code'].map(id => ({ id, available: true, displayName: id, pluginId: id, logoUrl: null,
            completedTurnDisplay: 'collapse' as const, composerActions: [], maintenance: { health: false, installation: false, usage: false },
            capabilities: { modelCatalogScope: 'host' as const, permissionModes: ['auto' as const], supportsFork: false,
              supportsNativeUserQuestion: false, supportsServiceTier: false, supportsSessionRewind: false,
              supportsThreadArchive: false, supportsThreadRename: false },
          })), permissionCeiling: 'auto', selectedOnlyModels: [], modelLoadError: null,
          models: (providerId === 'claude-code' ? ['sonnet'] : ['new-model', 'other-model']).map(model => ({
            id: model, model, displayName: model === 'new-model' ? 'New model' : model, description: '', isDefault: false,
            defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }],
          })),
        }),
      },
      threads: { get: async () => makeThreadResponse({ id: 't1', environmentId: 'e1' }) },
      plugins: { callRpc: async ({ method, outputSchema }) => outputSchema.parse(method === 'favourites.list'
        ? [{ id: 'deep', slot: 2, name: 'Deep', providerId: 'codex', model: 'new-model', reasoningLevel: 'high' }]
        : method === 'accounts' ? { supported: true, currentId: 'default', profiles: [{ id: 'default', label: 'Default', configDir: null }, { id: 'work', label: 'Work', configDir: null }] }
          : { currentId: 'work' }) },
      providers: { models: async () => ({
        modelLoadError: null, permissionCeiling: 'full', providers: [], selectedOnlyModels: [],
        models: [{ id: 'new-model', model: 'new-model', displayName: 'New model', description: '',
          defaultReasoningEffort: 'medium', supportedReasoningEfforts: [], isDefault: false },
          { id: 'other-model', model: 'other-model', displayName: 'Other model', description: '',
            defaultReasoningEffort: 'medium', supportedReasoningEfforts: [], isDefault: false }],
      }) },
      ...options.sdk,
    },
  });
  const rendered = slot;
  headerSlot = renderSlot(app.threadHeaderActions[0], { threadId: 't1', projectId: 'p1', isCompactViewport: false });
  let sequence = 0;
  return {
    archived, restored, approvals,
    slot: rendered,
    async command(command: Command) {
      const count = replies.length;
      await rendered.behavior.emitRealtime('command', { requestId: String(++sequence), command });
      await waitFor(() => expect(replies.length).toBe(count + 1));
      return replies[replies.length - 1];
    },
  };
}

function NativeQuestion({ multi = false, disabled = false }: { multi?: boolean; disabled?: boolean }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [open, setOpen] = useState(true);
  const choose = (number: number) => setSelected(current => multi
    ? current.includes(number) ? current.filter(item => item !== number) : [...current, number] : [number]);
  if (!open) return null;
  return <div tabIndex={-1}><fieldset disabled={disabled}>
    <legend>Native question</legend>
    <button aria-pressed={selected.includes(1)} onClick={() => choose(1)}>Answer one</button>
    <button aria-pressed={selected.includes(2)} onClick={() => choose(2)}>Answer two</button>
  </fieldset><button onClick={() => setOpen(false)}>Submit answers</button></div>;
}

test('spoken choose selects a native answer without submitting', async () => {
  const view = await render('idle', undefined, undefined, { nativeQuestion: {} });
  expect(await view.command({ action: 'choose', number: 1 })).toMatchObject({ ok: true, message: 'Selected Answer one.' });
  expect(view.slot.getByRole('button', { name: 'Answer one' }).getAttribute('aria-pressed')).toBe('true');
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('spoken submission completes the question without submitting the retained task', async () => {
  const view = await render('idle', undefined, undefined, { nativeQuestion: {} });
  await view.command({ action: 'choose', number: 2 });
  expect(await view.command({ action: 'submit-answer' })).toMatchObject({ ok: true, outcome: 'completed' });
  expect(view.slot.queryByRole('button', { name: 'Submit answers' })).toBeNull();
  expect(view.slot.inspection.composer.submits).toEqual([]);
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test('recorded submission rejects a changed answer and cannot submit twice', async () => {
  const view = await render('idle', undefined, undefined, { nativeQuestion: {} });
  const recorded = await view.command({ action: 'capture' });
  await view.command({ action: 'choose', number: 1 });
  expect(await view.command({ action: 'submit-answer', target: recorded.choiceTarget })).toMatchObject({ ok: false });
  expect(await view.command({ action: 'submit-answer', target: recorded.choiceTarget })).toMatchObject({ ok: false });
  expect(view.slot.getByRole('button', { name: 'Submit answers' })).toBeTruthy();
});

test('send submits through BB and refuses to send beneath a popup', async () => {
  const view = await render();
  await view.command({ action: 'attention' });
  expect(await view.command({ action: 'send' })).toMatchObject({ ok: false });
  expect(view.slot.inspection.composer.submits).toEqual([]);
  await view.command({ action: 'dismiss' });
  expect(await view.command({ action: 'send' })).toMatchObject({ ok: true });
  expect(view.slot.inspection.composer.submits).toHaveLength(1);
});

test('stop targets the focused thread and reports an unconfirmed interrupt honestly', async () => {
  const view = await render('active', undefined, undefined, { sdk: { threads: {
    stop: async () => ({ ok: true }),
    get: async () => makeThreadResponse({ id: 't1', status: 'stopping' }),
  } } });
  expect(await view.command({ action: 'stop' })).toMatchObject({ ok: true, outcome: 'requested', message: expect.stringMatching(/still stopping/) });
  expect(view.slot.inspection.sdkCalls).toContainEqual({ method: 'threads.stop', args: [{ threadId: 't1' }] });
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('spoken choose preserves multiple selection toggles', async () => {
  const view = await render('idle', undefined, undefined, { nativeQuestion: { multi: true } });
  await view.command({ action: 'choose', number: 1 });
  await view.command({ action: 'choose', number: 2 });
  expect(view.slot.getByRole('button', { name: 'Answer one' }).getAttribute('aria-pressed')).toBe('true');
  expect(view.slot.getByRole('button', { name: 'Answer two' }).getAttribute('aria-pressed')).toBe('true');
  await view.command({ action: 'choose', number: 1 });
  expect(view.slot.getByRole('button', { name: 'Answer one' }).getAttribute('aria-pressed')).toBe('false');
});

test('a focused voice list owns choices without falling through to a native answer', async () => {
  const view = await render('idle', undefined, undefined, { nativeQuestion: {} });
  await view.command({ action: 'attention' });
  expect((await view.command({ action: 'choose', number: 2 })).ok).toBe(false);
  expect(view.slot.getByRole('button', { name: 'Answer two' }).getAttribute('aria-pressed')).toBe('false');
  expect((await view.command({ action: 'choose', number: 1 })).ok).toBe(true);
  expect(view.slot.inspection.navigateCalls).toEqual([{ method: 'toThread', threadId: 'waiting' }]);
});

test('visible voice matches keep their numbers when focus returns to the question', async () => {
  const view = await render('idle', undefined, undefined, { nativeQuestion: {} });
  await view.command({ action: 'attention' });
  view.slot.getByRole('button', { name: 'Answer two' }).focus();
  expect((await view.command({ action: 'choose', number: 2 })).ok).toBe(false);
  expect(view.slot.getByRole('button', { name: 'Answer two' }).getAttribute('aria-pressed')).toBe('false');
  expect(view.slot.inspection.navigateCalls).toEqual([]);
});

test('disabled native answers reject spoken selection', async () => {
  const view = await render('idle', undefined, undefined, { nativeQuestion: { disabled: true } });
  expect((await view.command({ action: 'choose', number: 1 })).ok).toBe(false);
  expect(view.slot.getByRole('button', { name: 'Answer one' }).getAttribute('aria-pressed')).toBe('false');
});

test('next unread opens the oldest unseen stopped reply, including a text question or error', async () => {
  const view = await render('idle', undefined, [
    thread('newer', { isUnread: true, latestAttentionAt: 20 }),
    thread('question', { isUnread: true, latestAttentionAt: 10 }),
    thread('error', { isUnread: true, status: 'error', runtimeStatus: 'error', latestAttentionAt: 5 }),
  ]);
  expect(await view.command({ action: 'unread' })).toMatchObject({ ok: true, outcome: 'requested', message: expect.stringContaining('error') });
  expect(view.slot.inspection.navigateCalls).toEqual([{ method: 'toThread', threadId: 'error' }]);
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test('next unread excludes the current thread, read replies, archived or hidden threads and ongoing work', async () => {
  const view = await render('idle', undefined, [
    thread('t1', { isUnread: true }),
    thread('read'),
    thread('archived', { isUnread: true, isArchived: true }),
    thread('hidden', { isUnread: true, isHidden: true }),
    thread('running', { isUnread: true, status: 'active', runtimeStatus: 'active' }),
    thread('background', { isUnread: true, activity: { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 } }),
    thread('queued', { isUnread: true, queuedWork: 'waiting' }),
  ]);
  expect(await view.command({ action: 'unread' })).toMatchObject({ ok: true, outcome: 'empty' });
  expect(view.slot.inspection.navigateCalls).toEqual([]);
});

test('show Git uses the selected thread button and repeated requests keep it open', async () => {
  const view = await render();
  const chip = document.createElement('button');
  chip.dataset.gitGlance = 't1';
  chip.setAttribute('aria-expanded', 'false');
  let clicks = 0;
  chip.onclick = () => { clicks++; chip.setAttribute('aria-expanded', 'true'); };
  document.body.append(chip);
  try {
    await view.command({ action: 'show', view: 'git' });
    await view.command({ action: 'show', view: 'git' });
    expect(clicks).toBe(1);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(view.slot.inspection.composer.submits).toEqual([]);
  } finally { chip.remove(); }
});

test('show usage activates the existing all-accounts button', async () => {
  const view = await render();
  const chip = document.createElement('button');
  chip.setAttribute('aria-label', 'Open all agent usage. Codex');
  let opened = false;
  chip.onclick = () => { opened = true; };
  document.body.append(chip);
  try {
    expect((await view.command({ action: 'show', view: 'usage' })).ok).toBe(true);
    expect(opened).toBe(true);
  } finally { chip.remove(); }
});

test('missing popup controls report unavailable rather than claiming to open', async () => {
  const view = await render();
  expect(await view.command({ action: 'show', view: 'git' })).toMatchObject({ ok: false, outcome: 'error' });
  expect(await view.command({ action: 'show', view: 'usage' })).toMatchObject({ ok: false, outcome: 'error' });
});

test('close popup clears voice choices and requests Escape without sending text', async () => {
  const view = await render();
  await view.command({ action: 'attention' });
  expect(await view.command({ action: 'dismiss' })).toMatchObject({ ok: true, outcome: 'requested', press: { key: 'escape', modifiers: [] } });
  expect(view.slot.queryByRole('button', { name: /waiting/ })).toBeNull();
  expect(view.slot.inspection.composer.focusCount).toBe(1);
  expect(view.slot.inspection.composer.submits).toEqual([]);
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test('idle archive targets the selected thread and spoken restore opens it', async () => {
  const view = await render();
  expect((await view.command({ action: 'archive' })).ok).toBe(true);
  expect(view.archived).toEqual(['t1']);
  expect(view.slot.inspection.composer.submits).toEqual([]);
  expect((await view.command({ action: 'restore' })).ok).toBe(true);
  expect(view.restored).toEqual(['t1']);
  expect(view.slot.inspection.navigateCalls.at(-1)).toEqual({ method: 'toThread', threadId: 't1' });
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
  expect(view.slot.inspection.navigateCalls).toEqual([]);
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test('focus loss during archive inspection prevents the mutation', async () => {
  const view = await render('idle', () => { vi.spyOn(document, 'hasFocus').mockReturnValue(false); });
  expect((await view.command({ action: 'archive' })).ok).toBe(false);
  expect(view.archived).toEqual([]);
  expect(view.slot.inspection.navigateCalls).toEqual([]);
});

test('Enter does not confirm an archive or submit the retained draft', async () => {
  const view = await render('active');
  await view.command({ action: 'archive' });
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(view.archived).toEqual([]);
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('approval decisions target the selected thread', async () => {
  const view = await render();
  expect(await view.command({ action: 'approve', decision: 'allow_once' })).toMatchObject({ ok: true, message: 'Allowed once: ls' });
  expect(view.approvals).toEqual([{ threadId: 't1', decision: 'allow_once' }]);
});

test('voice commands target the focused split pane instead of the route thread', async () => {
  const view = await render('idle', undefined, [thread('t1'), thread('t2', { projectId: 'p2' })], {
    composer: { scope: { kind: 'thread', threadId: 't2' } },
    sidebarSplitLayout: { panes: [
      { paneId: 'left', threadId: 't1', isFocused: false, rect: { x: 0, y: 0, width: 0.5, height: 1 } },
      { paneId: 'right', threadId: 't2', isFocused: true, rect: { x: 0.5, y: 0, width: 0.5, height: 1 } },
    ] },
  });
  await view.command({ action: 'approve', decision: 'allow_once' });
  expect(view.approvals).toEqual([{ threadId: 't2', decision: 'allow_once' }]);
  await view.command({ action: 'new' });
  expect(view.slot.inspection.navigateCalls).toEqual([{ method: 'toCompose', options: { projectId: 'p2', focusPrompt: true } }]);
});

test('focus chat closes voice choices and focuses the composer without submitting', async () => {
  const view = await render();
  await view.command({ action: 'attention' });
  expect((await view.command(commandSchema.parse({ action: 'focus' }))).ok).toBe(true);
  expect(view.slot.inspection.composer.focusCount).toBe(1);
  expect(view.slot.queryByRole('dialog')).toBeNull();
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('state names the focused thread, project, provider and model', async () => {
  const view = await render();
  expect(await view.command({ action: 'state' })).toMatchObject({ ok: true, message: expect.stringContaining('dotfiles') });
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('pausing BB commands blocks actions and resuming restores them', async () => {
  const view = await render();
  expect(await view.command({ action: 'listen', enabled: false })).toMatchObject({ ok: true });
  expect(await view.command({ action: 'new' })).toMatchObject({ ok: false, message: expect.stringMatching(/paused/) });
  expect(view.slot.inspection.navigateCalls).toEqual([]);
  expect(await view.command({ action: 'listen', enabled: true })).toMatchObject({ ok: true });
  expect(await view.command({ action: 'new' })).toMatchObject({ ok: true });
});

test('heard feedback reports the preceding recognition attempt rather than its own phrase', async () => {
  const view = await render('idle', undefined, undefined, { diagnostics: () => ({ available: true, state: null, transcript: null,
    attempts: [{ at: 1, kind: 'command', heard: 'Start the thread', command: null, result: 'Unmatched speech', problem: false, unmatched: true, context: 'bb' },
      { at: 2, kind: 'command', heard: 'What did you hear?', command: 'bb-heard', result: 'Submitted', problem: false, unmatched: false, context: 'bb' }],
  }) });
  expect(await view.command({ action: 'heard' })).toMatchObject({ ok: true, message: expect.stringContaining('Start the thread') });
});

test('reading queues the last reply without speaking Markdown markup and can stop it', async () => {
  const speak = vi.spyOn(speechSynthesis, 'speak');
  const view = await render('idle', undefined, undefined, { sdk: { threads: { output: async () => ({ output: '**Done.** See [the report](https://example.com).' }) } } });
  expect(await view.command({ action: 'read' })).toMatchObject({ ok: true });
  expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Done. See the report.' }));
  const cancel = vi.spyOn(speechSynthesis, 'cancel').mockClear();
  await view.command({ action: 'stop-reading' });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('long readouts retain all words across bounded speech chunks', async () => {
  const speak = vi.spyOn(speechSynthesis, 'speak');
  const output = 'A complete sentence. '.repeat(200).trim();
  const view = await render('idle', undefined, undefined, { sdk: { threads: { output: async () => ({ output }) } } });
  await view.command({ action: 'read' });
  const chunks = speak.mock.calls.map(([utterance]) => utterance.text);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every(chunk => chunk.length <= 1500)).toBe(true);
  expect(chunks.join(' ')).toBe(output);
});

test('unavailable speech cannot turn a completed action into a failed command', async () => {
  vi.stubGlobal('speechSynthesis', undefined);
  const view = await render('idle', undefined, undefined, { settings: { spokenFeedback: true } });
  expect(await view.command({ action: 'new' })).toMatchObject({ ok: true, message: expect.stringContaining('Speech output is unavailable') });
  expect(view.slot.inspection.navigateCalls).toHaveLength(1);
});

test('spoken confirmations persist through plugin settings and can be muted', async () => {
  const view = await render('idle', undefined, undefined, { sdk: { plugins: {
    updateSettings: async ({ values }) => ({ ok: true, schema: {}, values }),
  } } });
  expect(await view.command({ action: 'feedback', enabled: true })).toMatchObject({ ok: true });
  expect(view.slot.inspection.sdkCalls).toContainEqual({ method: 'plugins.updateSettings', args: [{ pluginId: 'handsfree', values: { spokenFeedback: true } }] });
  await view.command({ action: 'feedback', enabled: false });
  expect(view.slot.inspection.sdkCalls).toContainEqual({ method: 'plugins.updateSettings', args: [{ pluginId: 'handsfree', values: { spokenFeedback: false } }] });
});

test('focus chat refuses an unavailable pane composer instead of focusing another thread', async () => {
  const view = await render('idle', undefined, undefined, { sidebarSplitLayout: { panes: [
    { paneId: 'other', threadId: 't2', isFocused: true, rect: { x: 0, y: 0, width: 1, height: 1 } },
  ] } });
  expect(await view.command(commandSchema.parse({ action: 'focus' }))).toMatchObject({ ok: false, message: expect.stringContaining('unavailable') });
  expect(view.slot.inspection.composer.focusCount).toBe(0);
});

test('focus chat reports a blocking popup without stealing its focus', async () => {
  const view = await render();
  const popup = document.createElement('div');
  popup.setAttribute('role', 'dialog');
  document.body.append(popup);
  try {
    expect(await view.command(commandSchema.parse({ action: 'focus' }))).toMatchObject({ ok: false, message: expect.stringContaining('close popup') });
    expect(view.slot.inspection.composer.focusCount).toBe(0);
  } finally { popup.remove(); }
});

test('changing a draft project preserves its text and attachments without navigation or submission', async () => {
  const view = await render('idle', undefined, undefined, { composer: {
    scope: { kind: 'new-thread', projectId: 'p1' },
    attachments: [{ type: 'localFile', path: 'uploads/spec.txt', name: 'spec.txt', sourceProjectId: 'p1' }],
  } });
  const before = view.slot.inspection.composer.draft;
  const list = await view.command({ action: 'list', kind: 'project' });
  expect(await view.command({ action: 'select', kind: 'project', id: 'p2', context: list.context ?? '' })).toMatchObject({ ok: true });
  expect(view.slot.inspection.composer.selections).toEqual([{ projectId: 'p2' }]);
  expect(view.slot.inspection.composer.draft).toEqual(before);
  expect(view.slot.inspection.composer.focusCount).toBe(1);
  expect(view.slot.inspection.navigateCalls).toEqual([]);
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('new thread opens a draft in the current project without submitting text', async () => {
  const view = await render();
  expect((await view.command({ action: 'new' })).ok).toBe(true);
  expect(view.slot.inspection.navigateCalls).toEqual([{ method: 'toCompose', options: { projectId: 'p1', focusPrompt: true } }]);
  expect(view.slot.inspection.composer.submits).toEqual([]);
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test('choose without an active panel returns an immediate explanation', async () => {
  const view = await render();
  expect(await view.command({ action: 'choose', number: 1 })).toMatchObject({
    ok: false, message: 'There is no active question.',
  });
  expect(view.slot.inspection.navigateCalls).toEqual([]);
});

test('who needs me excludes hidden threads and Enter selects rather than sends the draft', async () => {
  const view = await render();
  await view.command({ action: 'attention' });
  expect(view.slot.queryByText(/hidden \(/)).toBe(null);
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  fireEvent(document, enter);
  await waitFor(() => expect(view.slot.inspection.navigateCalls).toEqual([{ method: 'toThread', threadId: 'waiting' }]));
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
  expect(view.slot.inspection.navigateCalls).toEqual([]);
  expect(view.slot.inspection.composer.focusCount).toBe(1);
});

test('Escape reaches an unrelated BB popup while the monitor is open', async () => {
  const view = await render();
  await view.command({ action: 'monitor' });
  const popup = document.createElement('div');
  popup.setAttribute('role', 'dialog');
  document.body.append(popup);
  try {
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(popup, escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(view.slot.getByRole('dialog', { name: 'Voice monitor' })).toBeTruthy();
    expect(view.slot.inspection.composer.focusCount).toBe(0);
  } finally { popup.remove(); }
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
    expect(view.slot.inspection.navigateCalls).toEqual([]);
  } finally { textarea.remove(); }
});

test('routine success stays in the header while help opens the monitor', async () => {
  const view = await render();
  await view.command({ action: 'new' });
  expect(view.slot.getByRole('button', { name: /Voice monitor\. Opening a new thread/ }).getAttribute('aria-expanded')).toBe('false');
  expect(view.slot.queryByRole('dialog')).toBeNull();
  await view.command({ action: 'help' });
  expect(view.slot.getByRole('button', { name: /Voice monitor\./ }).getAttribute('aria-expanded')).toBe('true');
});

test('a stale match cannot act on a different thread', async () => {
  const view = await render();
  const current = await view.command({ action: 'list', kind: 'thread' });
  if (!current.context) throw new Error('No voice context');
  const reply = await view.command({ action: 'select', kind: 'thread', id: 'waiting', context: current.context.replace('t1:p1', 'other-thread:p1') });
  expect(reply.ok).toBe(false);
  expect(reply.message).toMatch(/selected thread changed/);
  expect(view.slot.inspection.navigateCalls).toEqual([]);
});

test('finished means unread successful results rather than every idle thread', async () => {
  const view = await render();
  await view.command({ action: 'finished' });
  await view.command({ action: 'choose', number: 1 });
  expect(view.slot.inspection.navigateCalls).toEqual([{ method: 'toThread', threadId: 'done' }]);
});

test('unfocused windows do not claim or execute voice commands', async () => {
  const view = await render();
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  await view.slot.behavior.emitRealtime('command', { requestId: 'background', command: { action: 'new' } });
  expect(view.slot.inspection.rpcCalls.filter(call => call.method !== 'diagnostics')).toEqual([]);
  expect(view.slot.inspection.navigateCalls).toEqual([]);
});

test('a busy focused window claims and rejects a second command', async () => {
  let inspecting!: () => void;
  const started = new Promise<void>(resolve => { inspecting = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const view = await render('idle', () => { inspecting(); return gate; });
  await view.slot.behavior.emitRealtime('command', { requestId: 'first', command: { action: 'archive' } });
  await started;
  await view.slot.behavior.emitRealtime('command', { requestId: 'second', command: { action: 'new' } });
  await waitFor(() => expect(view.slot.inspection.rpcCalls.filter(call => call.method === 'complete')).toHaveLength(1));
  release();
  await waitFor(() => expect(view.slot.inspection.rpcCalls.filter(call => call.method === 'complete')).toHaveLength(2));
  const busy = view.slot.inspection.rpcCalls.find(call => call.method === 'complete' && (call.input as { requestId: string }).requestId === 'second');
  expect(busy?.input).toMatchObject({ reply: { ok: false, message: expect.stringMatching(/Busy/) } });
});

test('model selection uses the visible composer and its machine without sending a message', async () => {
  const view = await render();
  const current = await view.command({ action: 'list', kind: 'model' });
  if (!current.context) throw new Error('No voice context');
  const reply = await view.command({ action: 'select', kind: 'model', id: JSON.stringify(['codex', 'new-model']), context: current.context });
  expect(reply.ok).toBe(true);
  expect(view.slot.inspection.sdkCalls).toContainEqual({ method: 'system.executionOptions', args: [{ providerId: 'codex', environmentId: 'e1' }] });
  expect(view.slot.inspection.composer.selections).toEqual([{ providerId: 'codex', model: 'new-model', reasoningLevel: 'medium' }]);
  expect(view.slot.inspection.composer.submits).toEqual([]);
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test('models include other providers and a selection applies the provider without sending', async () => {
  const view = await render();
  const list = await view.command({ action: 'list', kind: 'model' });
  expect(list.candidates).toContainEqual({ id: '["claude-code","sonnet"]', title: 'sonnet', label: 'sonnet (claude-code)' });
  const reply = await view.command({ action: 'select', kind: 'model', id: '["claude-code","sonnet"]', context: list.context! });
  expect(reply.ok).toBe(true);
  expect(view.slot.inspection.composer.selection).toMatchObject({ providerId: 'claude-code', model: 'sonnet', reasoningLevel: 'medium' });
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('favourites retain their slots and apply saved effort', async () => {
  const view = await render();
  const list = await view.command({ action: 'list', kind: 'favourite' });
  expect(list.candidates?.[0]).toMatchObject({ id: 'deep', title: '2' });
  expect(await view.command({ action: 'select', kind: 'favourite', id: 'deep', context: list.context! })).toMatchObject({ ok: true });
  expect(view.slot.inspection.composer.selection).toMatchObject({ model: 'new-model', reasoningLevel: 'high' });
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test('accounts switch Claude threads through Agent Switcher', async () => {
  const view = await render('idle', undefined, undefined, { composer: { selection: { providerId: 'claude-code', model: 'sonnet' } } });
  const list = await view.command({ action: 'list', kind: 'account' });
  expect(await view.command({ action: 'select', kind: 'account', id: 'work', context: list.context! })).toMatchObject({ ok: true });
  expect(view.slot.inspection.sdkCalls).toContainEqual({ method: 'plugins.callRpc', args: [expect.objectContaining({ pluginId: 'claude-profiles', method: 'choose', input: { threadId: 't1', profileId: 'work' } })] });
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('account selection targets a new draft and leaves its text intact', async () => {
  const view = await render('idle', undefined, undefined, { composer: {
    scope: { kind: 'new-thread', projectId: 'p1' }, selection: { providerId: 'claude-code', model: 'sonnet' },
  } });
  const list = await view.command({ action: 'list', kind: 'account' });
  expect(await view.command({ action: 'select', kind: 'account', id: 'work', context: list.context! })).toMatchObject({ ok: true });
  expect(view.slot.inspection.sdkCalls).toContainEqual({ method: 'plugins.callRpc', args: [expect.objectContaining({ method: 'choose', input: { threadId: null, profileId: 'work' } })] });
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test('accounts reject unsupported providers and running turns without sending a switch', async () => {
  const unsupported = await render();
  expect(await unsupported.command({ action: 'list', kind: 'account' })).toMatchObject({ ok: false, message: expect.stringMatching(/Claude Code/) });
  unsupported.slot.lifecycle.unmount();
  headerSlot?.lifecycle.unmount();
  const running = await render('active', undefined, undefined, { composer: { isRunning: true, selection: { providerId: 'claude-code', model: 'sonnet' } } });
  const list = await running.command({ action: 'list', kind: 'account' });
  expect(await running.command({ action: 'select', kind: 'account', id: 'work', context: list.context! })).toMatchObject({ ok: false, message: expect.stringMatching(/finish this turn/) });
  expect(running.slot.inspection.sdkCalls.filter(call => call.method === 'plugins.callRpc').some(call => (call.args[0] as { method: string }).method === 'choose')).toBe(false);
});

test('focus loss during final model validation prevents changing the old composer', async () => {
  let reads = 0;
  const view = await render('idle', undefined, undefined, { sdk: { threads: { get: async () => {
    if (++reads === 3) vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    return makeThreadResponse({ id: 't1', environmentId: 'e1' });
  } } } });
  const list = await view.command({ action: 'list', kind: 'model' });
  expect(await view.command({ action: 'select', kind: 'model', id: '["codex","new-model"]', context: list.context! })).toMatchObject({ ok: false, message: expect.stringMatching(/focus changed/) });
  expect(view.slot.inspection.composer.selections).toEqual([]);
});

test('project choices open a draft without moving the existing thread', async () => {
  const view = await render();
  const list = await view.command({ action: 'list', kind: 'project' });
  if (!list.context || !list.candidates) throw new Error('Missing project list');
  await view.command({ action: 'choices', kind: 'project', context: list.context, options: list.candidates, message: 'Choose a project' });
  await view.command({ action: 'choose', number: 1 });
  expect(view.slot.inspection.navigateCalls).toEqual([{ method: 'toCompose', options: { projectId: 'p1', focusPrompt: true } }]);
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('voice feedback retains the heard target alongside the result', async () => {
  const view = await render();
  await view.command({ action: 'notice', message: 'Heard thread target: access thread' });
  await view.command({ action: 'new' });
  fireEvent.click(view.slot.getByRole('button', { name: /Voice monitor\./ }));
  expect(view.slot.getByText('Heard thread target: access thread')).toBeTruthy();
  expect(view.slot.getAllByText(/Opening a new thread/).length).toBeGreaterThan(0);
});


test.each(['q', 'Q'])('%s closes focused voice help but leaves composer typing alone', async key => {
  const view = await render();
  await view.command({ action: 'attention' });
  fireEvent.keyDown(document, { key });
  expect(view.slot.inspection.composer.focusCount).toBe(0);
  const choice = view.slot.getByRole('button', { name: /waiting/ });
  fireEvent.keyDown(choice, { key, metaKey: true });
  expect(view.slot.inspection.composer.focusCount).toBe(0);
  fireEvent.keyDown(choice, { key });
  expect(view.slot.inspection.composer.focusCount).toBe(1);
  expect(view.slot.queryByRole('button', { name: /waiting/ })).toBeNull();
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test('voice feedback belongs in a header control, with no persistent floating card', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  expect(app.threadHeaderActions).toHaveLength(1);
  const view = await render();
  expect(view.slot.queryByRole('button', { name: 'Voice' })).toBeNull();
  expect(view.slot.queryByText(/Right Alt:/)).toBeNull();
  await view.command({ action: 'help' });
  expect(view.slot.getByRole('dialog', { name: 'Voice monitor' })).toBeTruthy();
  expect(view.slot.queryByText(/Right Alt:/)).toBeNull();
});

test('monitor activity exposes failed attempts without opening a disclosure', async () => {
  const view = await render();
  await view.command({ action: 'choose', number: 1 });
  fireEvent.click(view.slot.getByRole('button', { name: /Voice monitor\./ }));
  fireEvent.click(view.slot.getByRole('tab', { name: 'Activity' }));
  expect(view.slot.getByRole('tabpanel', { name: 'Activity' }).textContent).toMatch(/There is no active question/);
  expect(view.slot.getByRole('tabpanel', { name: 'Activity' }).textContent).toMatch(/Failed/);
});


test('monitor shows actual Hex transcription and details without marking background speech as failure', async () => {
  const now = Date.now();
  const view = await render('idle', undefined, undefined, { diagnostics: () => ({ available: true,
    state: { at: now, state: 'transcribing' },
    transcript: { at: now, phase: 'updated', latency: 120, text: 'go to access thread' },
    attempts: [{ at: now, kind: 'command', heard: 'background conversation', command: null,
      result: 'Unmatched speech', problem: false, unmatched: true, context: 'bb' }] }) });
  await waitFor(() => expect(view.slot.getByRole('button', { name: /Voice monitor.*Transcribing/ })).toBeTruthy());
  expect(view.slot.queryByRole('dialog')).toBeNull();
  fireEvent.click(view.slot.getByRole('button', { name: /Voice monitor/ }));
  expect(view.slot.getByText('go to access thread')).toBeTruthy();
  expect(view.slot.queryByText('background conversation')).toBeNull();
  fireEvent.click(view.slot.getByRole('checkbox', { name: 'Include unmatched speech' }));
  expect(view.slot.getByText('background conversation')).toBeTruthy();
  expect(view.slot.queryByText('Failed')).toBeNull();
});

test('voice monitor command opens Activity and exposes native failure details', async () => {
  const view = await render('idle', undefined, undefined, { diagnostics: () => ({ available: true, state: null, transcript: null,
    attempts: [{ at: Date.now(), kind: 'command', heard: 'next thread', command: 'next_thread',
      result: 'No focused window', problem: true, unmatched: false, context: 'bb' }] }) });
  await view.command({ action: 'monitor' });
  await waitFor(() => expect(view.slot.getByText('No focused window')).toBeTruthy());
  expect(view.slot.getByRole('tab', { name: 'Activity' }).getAttribute('aria-selected')).toBe('true');
  expect(view.slot.getByText('next_thread')).toBeTruthy();
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});


test('capture feedback expires and polling stops when the controller unmounts', async () => {
  vi.useFakeTimers();
  const now = Date.now();
  const read = vi.fn(() => ({ available: true, state: { at: now, state: 'dictating' as const }, transcript: null, attempts: [] }));
  const view = await render('idle', undefined, undefined, { diagnostics: read });
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(view.slot.getByRole('button', { name: /Voice monitor.*Recording/ })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(view.slot.getByRole('button', { name: 'Voice monitor. Voice' })).toBeTruthy();
  view.slot.lifecycle.unmount(); slot = undefined;
  const count = read.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(read.mock.calls.length).toBe(count);
});


test('opening a project draft requests host focus without claiming completion', async () => {
  const view = await render();
  expect(await view.command({ action: 'new' })).toMatchObject({ ok: true, outcome: 'requested' });
  expect(view.slot.inspection.navigateCalls).toEqual([{ method: 'toCompose', options: { projectId: 'p1', focusPrompt: true } }]);
  expect(view.slot.inspection.composer.focusCount).toBe(0);
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
});

test.each(['thread', 'project', 'model'] as const)('a single %s match selects directly without a picker', async kind => {
  const view = await render();
  const list = await view.command({ action: 'list', kind });
  if (!list.context || !list.candidates?.length) throw new Error('Missing choices');
  const option = list.candidates[0];
  const reply = await view.command({ action: 'choices', kind, context: list.context, options: [option], message: 'Choose a match' });
  expect(reply.ok).toBe(true);
  expect(reply.outcome).not.toBe('choices');
  expect(view.slot.queryByRole('dialog')).toBeNull();
  if (kind === 'thread') expect(view.slot.inspection.navigateCalls).toEqual([{ method: 'toThread', threadId: option.id }]);
  if (kind === 'project') expect(view.slot.inspection.navigateCalls).toEqual([{ method: 'toCompose', options: { projectId: option.id, focusPrompt: true } }]);
  if (kind === 'model') expect(view.slot.inspection.composer.selections).toEqual([{ providerId: 'codex', model: 'new-model', reasoningLevel: 'medium' }]);
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test.each(['thread', 'project', 'model'] as const)('temporary %s choices close after selection without opening diagnostics', async kind => {
  const view = await render();
  const list = await view.command({ action: 'list', kind });
  if (!list.context || !list.candidates) throw new Error('Missing choices');
  await view.command({ action: 'choices', kind, context: list.context, options: list.candidates.slice(0, 2), message: 'Choose a match' });
  expect(view.slot.getByRole('list', { name: 'Voice choices' })).toBeTruthy();
  await view.command({ action: 'choose', number: 1 });
  expect(view.slot.queryByRole('dialog')).toBeNull();
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('explicitly opened monitor stays open after temporary choices complete', async () => {
  const view = await render();
  await view.command({ action: 'monitor' });
  await view.command({ action: 'attention' });
  await view.command({ action: 'choose', number: 1 });
  expect(view.slot.getByRole('dialog', { name: 'Voice monitor' })).toBeTruthy();
  expect(view.slot.queryByRole('list', { name: 'Voice choices' })).toBeNull();
});

test('invalid numbered choice retains the prompt for retry, then closes after a valid choice', async () => {
  const view = await render();
  await view.command({ action: 'attention' });
  expect((await view.command({ action: 'choose', number: 9 })).ok).toBe(false);
  expect(view.slot.getByRole('list', { name: 'Voice choices' })).toBeTruthy();
  await view.command({ action: 'choose', number: 1 });
  expect(view.slot.queryByRole('dialog')).toBeNull();
});

test('temporary archive confirmation closes after confirmation or cancellation', async () => {
  const view = await render('running');
  await view.command({ action: 'archive' });
  await view.command({ action: 'cancel-archive' });
  expect(view.slot.queryByRole('dialog')).toBeNull();
  await view.command({ action: 'archive' });
  await view.command({ action: 'confirm-archive' });
  expect(view.slot.queryByRole('dialog')).toBeNull();
});

test('failure notices remain in the header without opening diagnostics', async () => {
  const view = await render();
  await view.command({ action: 'notice', problem: true, message: 'No matching thread' });
  expect(view.slot.queryByRole('dialog')).toBeNull();
  expect(view.slot.getByRole('button', { name: /Voice monitor.*No matching thread/ })).toBeTruthy();
});


test('recorded native selection survives feedback but rejects a changed question', async () => {
  const view = await render('idle', undefined, undefined, { nativeQuestion: {} });
  const captured = await view.command({ action: 'capture' });
  await view.command({ action: 'notice', message: 'Heard choose one' });
  await view.command({ action: 'list', kind: 'thread' });
  expect((await view.command({ action: 'choose', number: 1, target: captured.choiceTarget })).ok).toBe(true);
  expect((await view.command({ action: 'choose', number: 1, target: captured.choiceTarget })).ok).toBe(false);
  expect(view.slot.getByRole('button', { name: 'Answer one' }).getAttribute('aria-pressed')).toBe('true');
  const next = await view.command({ action: 'capture' });
  view.slot.getByText('Native question').textContent = 'Changed question';
  expect((await view.command({ action: 'choose', number: 2, target: next.choiceTarget })).ok).toBe(false);
  expect(view.slot.getByRole('button', { name: 'Answer two' }).getAttribute('aria-pressed')).toBe('false');
});

test('recording feedback and context checks preserve archive confirmation', async () => {
  const view = await render('running');
  await view.command({ action: 'archive' });
  await view.command({ action: 'capture' });
  await view.command({ action: 'notice', message: 'Heard confirm archive' });
  await view.command({ action: 'list', kind: 'thread' });
  expect((await view.command({ action: 'confirm-archive' })).ok).toBe(true);
  expect(view.archived).toEqual(['t1']);
});


test('finishing a focused question returns to the composer without sending its draft', async () => {
  const view = await render('idle', undefined, undefined, { nativeQuestion: {} });
  await view.command({ action: 'choose', number: 1 });
  const root = view.slot.getByRole('button', { name: 'Answer one' }).closest('div[tabindex="-1"]')!;
  expect(document.activeElement).toBe(root);
  fireEvent.click(view.slot.getByRole('button', { name: 'Submit answers' }));
  await waitFor(() => expect(view.slot.inspection.composer.focusCount).toBe(1));
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('favourite choices show one stable slot number and choose that slot across gaps', async () => {
  const view = await render('idle', undefined, undefined, { sdk: { plugins: {
    callRpc: async ({ outputSchema }) => outputSchema.parse([
      { id: 'deep', slot: 2, name: 'Deep', providerId: 'codex', model: 'new-model', reasoningLevel: 'high' },
      { id: 'another', slot: 3, name: 'Another', providerId: 'codex', model: 'other-model', reasoningLevel: 'high' },
    ]),
  } } });
  const list = await view.command({ action: 'list', kind: 'favourite' });
  expect(list.candidates?.[0]?.label).toBe('Deep (Codex, high effort)');
  await view.command({ action: 'choices', kind: 'favourite', options: [...list.candidates!, { id: 'another', title: '3', label: 'Another (Codex, low effort)' }], context: list.context!, message: 'Choose a favourite.' });
  const button = view.slot.getByRole('button', { name: /2 Deep Codex, high effort/ });
  expect(button.textContent).not.toContain('2. 2.');
  expect(await view.command({ action: 'choose', number: 1 })).toMatchObject({ ok: false });
  expect(await view.command({ action: 'choose', number: 2 })).toMatchObject({ ok: true });
  expect(view.slot.inspection.composer.selection).toMatchObject({ model: 'new-model', reasoningLevel: 'high' });
});

test('mark unread targets the focused thread without navigating or submitting its draft', async () => {
  const marked: string[] = [];
  const view = await render('idle', undefined, undefined, {
    composer: { scope: { kind: 'thread', threadId: 'focused' } },
    sidebarSplitLayout: { panes: [
      { paneId: 'left', threadId: 't1', isFocused: false, rect: { x: 0, y: 0, width: 0.5, height: 1 } },
      { paneId: 'right', threadId: 'focused', isFocused: true, rect: { x: 0.5, y: 0, width: 0.5, height: 1 } },
    ] },
    sdk: { threads: { markUnread: async ({ threadId }) => {
      marked.push(threadId);
      return makeThreadResponse({ id: threadId, lastReadAt: null });
    } } },
  });
  expect(await view.command(commandSchema.parse({ action: 'mark-unread' }))).toMatchObject({ ok: true, outcome: 'completed' });
  expect(marked).toEqual(['focused']);
  expect(view.slot.inspection.navigateCalls).toEqual([]);
  expect(view.slot.inspection.composer.text).toBe('Unsent task');
  expect(view.slot.inspection.composer.submits).toEqual([]);
});

test('mark unread rejects a new thread draft', async () => {
  const view = await render('idle', undefined, undefined, { composer: { scope: { kind: 'new-thread', projectId: 'p1' } } });
  expect(await view.command(commandSchema.parse({ action: 'mark-unread' }))).toMatchObject({ ok: false, message: 'Select an existing thread to mark unread.' });
  expect(view.slot.inspection.sdkCalls.some(call => call.method === 'threads.markUnread')).toBe(false);
});

test('mark unread reports a failed update', async () => {
  const view = await render('idle', undefined, undefined, {
    sdk: { threads: { markUnread: async () => { throw new Error('Unread update failed.'); } } },
  });
  expect(await view.command(commandSchema.parse({ action: 'mark-unread' }))).toMatchObject({ ok: false, message: 'Unread update failed.' });
});
