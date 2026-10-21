import { expect, test } from 'vitest';
import { createFakeSdk } from '@get-bb/plugin-sdk/testing';
import { resolvePanelRun } from './panel-runs.ts';

test('finds an older panel run from recorded assistant directives through paged history', async () => {
  const { sdk, harness } = createFakeSdk({ pluginId: 'claude-profiles', overrides: { plugins: { callRpc: () => ({ runs: [] }) }, threads: {
    timeline: ({ beforeAnchorId }) => beforeAnchorId ? {
      rows: [{ kind: 'turn', children: [{ kind: 'conversation', role: 'assistant', text: '::workflow-preview{run="wfr_older-12345678"}' }] }],
      timelinePage: { olderCursor: null },
    } : {
      rows: [{ kind: 'conversation', role: 'assistant', text: '::workflow-preview{run="wfr_latest-87654321"}' }],
      timelinePage: { olderCursor: { anchorId: 'older', anchorSeq: 20 } },
    },
  } } });
  const signal = new AbortController().signal;
  expect(await resolvePanelRun(sdk, 'parent', '12345678', signal)).toBe('wfr_older-12345678');
  expect(harness.callsTo('threads.timeline')).toEqual([
    [{ threadId: 'parent', signal, deferContent: 'false', includeNestedRows: 'true', segmentLimit: '5' }],
    [{ threadId: 'parent', signal, deferContent: 'false', includeNestedRows: 'true', segmentLimit: '5', beforeAnchorId: 'older', beforeAnchorSeq: '20' }],
  ]);
});

test('ignores user-quoted directives and refuses ambiguous run suffixes', async () => {
  const { sdk } = createFakeSdk({ pluginId: 'claude-profiles', overrides: { plugins: { callRpc: () => ({ runs: [] }) }, threads: {
    timeline: () => ({ rows: [
      { kind: 'conversation', role: 'user', text: '::workflow-preview{run="wfr_fake-12345678"}' },
      { kind: 'conversation', role: 'assistant', text: '::workflow-preview{run="wfr_one-87654321"}\n::workflow-preview{run="wfr_two-87654321"}' },
    ], timelinePage: { olderCursor: null } }),
  } } });
  const signal = new AbortController().signal;
  expect(await resolvePanelRun(sdk, 'parent', '12345678', signal)).toBeNull();
  expect(await resolvePanelRun(sdk, 'parent', '87654321', signal)).toBeNull();
});

test('resolves an active run before a preview directive exists', async () => {
  const { sdk, harness } = createFakeSdk({ pluginId: 'claude-profiles', overrides: {
    plugins: { callRpc: () => ({ runs: [{ id: 'wfr_active-12345678' }] }) },
  } });
  expect(await resolvePanelRun(sdk, 'parent', '12345678', new AbortController().signal)).toBe('wfr_active-12345678');
  expect(harness.callsTo('threads.timeline')).toHaveLength(0);
});
