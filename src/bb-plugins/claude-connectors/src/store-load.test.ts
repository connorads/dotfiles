import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConnectors, loadThread, refresh, setClient, snapshot, type Rpc } from '../store.ts';

// A fake server: `failing` names the methods that reject; every call is logged.
const calls: string[] = [];
const failing = new Set<string>();
const connectorErrors = new Map<string, string>();
setClient({
  call: async (method: string, input: { profile?: string }) => {
    calls.push(input?.profile ? `${method}:${input.profile}` : method);
    if (failing.has(method)) throw new Error(`down: ${method}`);
    if (method === 'state') return { profiles: ['personal'], defaultChoice: 'personal', projects: [] };
    if (method === 'thread') return { threadId: 'thr_test01', own: null, resolved: { profile: 'personal', source: 'default' } };
    if (method === 'connectors') {
      const error = connectorErrors.get(input.profile!);
      return { connectors: error ? [] : ['Slack'], error: error ?? null };
    }
    throw new Error(`unexpected ${method}`);
  },
} as unknown as Rpc);

test('a failed connector list is fetched again, by the next load and by refresh', async () => {
  connectorErrors.set('studio', 'Not signed in.');
  await loadConnectors('studio');
  assert.deepEqual(snapshot().connectors.get('studio'), { list: [], error: 'Not signed in.' });
  connectorErrors.delete('studio');
  await refresh();
  assert.deepEqual(snapshot().connectors.get('studio'), { list: ['Slack'], error: null });
  calls.length = 0;
  await loadConnectors('studio');
  await refresh();
  assert.deepEqual(calls.filter(c => c.startsWith('connectors')), [], 'a loaded list is not fetched again');
  failing.add('connectors');
  await loadConnectors('work');
  failing.delete('connectors');
  await loadConnectors('work');
  assert.deepEqual(snapshot().connectors.get('work'), { list: ['Slack'], error: null });
});

test('refresh retries a thread whose load failed, and a success clears the error', async () => {
  failing.add('thread');
  await loadThread('thr_test01', 'prj_test01');
  assert.equal(snapshot().loadErrors.get('thread:thr_test01')?.error, 'down: thread');
  failing.delete('thread');
  await refresh();
  assert.equal(snapshot().loadErrors.has('thread:thr_test01'), false);
  assert.equal(snapshot().threads.get('thr_test01')?.resolved.profile, 'personal');
});
