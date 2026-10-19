// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot, type RenderedSlot } from '@get-bb/plugin-sdk/testing/app';
import type { useSdk } from '@get-bb/plugin-sdk/app';
import { getTimes, setTimes, setWanted } from './store';

let slot: RenderedSlot | undefined;
afterEach(() => { slot?.lifecycle.unmount(); slot = undefined; setTimes([]); setWanted(new Set()); });
type Page = Awaited<ReturnType<ReturnType<typeof useSdk>['threads']['timeline']>>;
const message = (id: string, timestamp: number): Page['rows'][number] => ({
  kind: 'conversation', id, threadId: 'thread', turnId: null,
  sourceSeqStart: 1, sourceSeqEnd: 1, messageSeq: 1,
  role: 'assistant', startedAt: timestamp, createdAt: timestamp + 100,
  text: '', attachments: null, turnRequest: null,
});
const page = (rows: Page['rows'], olderCursor: { anchorId: string; anchorSeq: number } | null = null): Page => ({
  rows, maxSeq: 5, contextBoundarySeq: null, completedTurnDisplay: 'collapse',
  activePromptMode: null, activeThinking: null, activeWorkflows: [], activeBackgroundCommands: [],
  pendingTodos: null, goal: null, modelFallback: null, contextWindowUsage: { estimated: false, modelContextWindow: 1000, usedTokens: 0 },
  timelinePage: { kind: 'latest', segmentLimit: 5, returnedSegmentCount: 1, hasOlderRows: olderCursor !== null, olderCursor },
});

it('loads older pages for rendered messages and uses recorded start times', async () => {
  setWanted(new Set(['thread:old', 'thread:new']));
  const app = await loadPluginApp(() => import('./app'));
  slot = renderSlot(app.appOverlays[0], {}, {
    context: { threadId: 'thread' },
    sdk: { threads: { timeline: async args => args.beforeAnchorId
      ? page([message('thread:old', 1000)])
      : page([message('thread:new', 2000)], { anchorId: 'cursor', anchorSeq: 5 }) } },
  });
  await waitFor(() => expect([...getTimes().keys()]).toEqual(['thread:new', 'thread:old']));
  expect(getTimes().get('thread:old')?.timestamp).toBe(1000);
  expect(slot.inspection.sdkCalls).toHaveLength(2);
});

it('ignores a late response after unmount', async () => {
  let finish: (value: Page) => void = () => { throw new Error('Request not started'); };
  const response = new Promise<Page>(resolve => { finish = resolve; });
  const app = await loadPluginApp(() => import('./app'));
  slot = renderSlot(app.appOverlays[0], {}, {
    context: { threadId: 'thread' }, sdk: { threads: { timeline: () => response } },
  });
  slot.lifecycle.unmount(); slot = undefined;
  await act(async () => { finish(page([message('thread:late', 1000)])); await response; });
  expect(getTimes().size).toBe(0);
});

it('reconciles after a connection change', async () => {
  let timestamp = 1000;
  const app = await loadPluginApp(() => import('./app'));
  slot = renderSlot(app.appOverlays[0], {}, {
    context: { threadId: 'thread' }, sdk: { threads: { timeline: async () => page([message('thread:a', timestamp)]) } },
  });
  await waitFor(() => expect(getTimes().get('thread:a')?.timestamp).toBe(1000));
  timestamp = 2000;
  await slot.behavior.setRealtimeConnectionState('connecting');
  await slot.behavior.setRealtimeConnectionState('connected');
  await waitFor(() => expect(getTimes().get('thread:a')?.timestamp).toBe(2000));
});

it('loads times when a new message row appears', async () => {
  let rows = [message('thread:first', 1000)];
  const app = await loadPluginApp(() => import('./app'));
  slot = renderSlot(app.appOverlays[0], {}, {
    context: { threadId: 'thread' }, sdk: { threads: { timeline: async () => page(rows) } },
  });
  await waitFor(() => expect(getTimes().has('thread:first')).toBe(true));
  rows = [...rows, message('thread:second', 2000)];
  act(() => { setWanted(new Set(['thread:first', 'thread:second'])); });
  await waitFor(() => expect(getTimes().get('thread:second')?.timestamp).toBe(2000), { timeout: 1500 });
});

it('does not read older history for an embedded chat from another thread', async () => {
  setWanted(new Set(['other:message']));
  const app = await loadPluginApp(() => import('./app'));
  slot = renderSlot(app.appOverlays[0], {}, {
    context: { threadId: 'thread' }, sdk: { threads: { timeline: async () =>
      page([message('thread:a', 1000)], { anchorId: 'cursor', anchorSeq: 5 }) } },
  });
  await waitFor(() => expect(getTimes().has('thread:a')).toBe(true));
  expect(slot.inspection.sdkCalls).toHaveLength(1);
});
