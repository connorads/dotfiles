import { beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reduceTraceRequest, type ReducerRunner } from './codex-reducer';

const sessionId = 'native-synthetic';
const identity = { sessionId, inferenceId: 'inference-2' };
let directory: string;
const ref = (id: number, type: string) => ({ raw_payload_id: `raw:${id}`, kind: { type }, path: `payloads/${id}.json` });
const message = (text: string) => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
const first = message('Synthetic initial input.');
const call = { type: 'function_call', name: 'synthetic_lookup', arguments: '{"query":"fixture"}', call_id: 'call-synthetic' };
const result = { type: 'function_call_output', call_id: 'call-synthetic', output: 'Synthetic retained result.' };
const values = [{ input: [first], tools: [] }, { output_items: [call] }, { previous_response_id: 'response-1', input: [result], tools: [] }];
const events = [
  { type: 'rollout_started', trace_id: 'trace-synthetic', root_thread_id: sessionId },
  { type: 'thread_started', thread_id: sessionId, agent_path: '/root', metadata_payload: null },
  { type: 'codex_turn_started', codex_turn_id: 'turn-synthetic', thread_id: sessionId },
  { type: 'inference_started', inference_call_id: 'inference-1', thread_id: sessionId, codex_turn_id: 'turn-synthetic', model: 'synthetic', provider_name: 'synthetic', request_payload: ref(1, 'inference_request') },
  { type: 'inference_completed', inference_call_id: 'inference-1', response_id: 'response-1', upstream_request_id: null, response_payload: ref(2, 'inference_response') },
  { type: 'inference_started', inference_call_id: identity.inferenceId, thread_id: sessionId, codex_turn_id: 'turn-synthetic', model: 'synthetic', provider_name: 'synthetic', request_payload: ref(3, 'inference_request') },
];
const graph = () => ({ schema_version: 1, root_thread_id: sessionId,
  conversation_items: { a: { thread_id: sessionId }, b: { thread_id: sessionId }, c: { thread_id: sessionId } },
  inference_calls: {
    'inference-1': { thread_id: sessionId, execution: { started_seq: 4 }, request_item_ids: ['a'], response_item_ids: ['b'], raw_request_payload_id: 'raw:1', raw_response_payload_id: 'raw:2' },
    'inference-2': { thread_id: sessionId, execution: { started_seq: 6 }, request_item_ids: ['a', 'b', 'c'], response_item_ids: [], raw_request_payload_id: 'raw:3', raw_response_payload_id: null },
  },
});
beforeEach(async () => {
  directory = await mkdtemp(join(await realpath(tmpdir()), 'codex-reducer-test-'));
  await mkdir(join(directory, 'payloads'));
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ schema_version: 1, trace_id: 'trace-synthetic', rollout_id: 'rollout-synthetic', root_thread_id: sessionId, started_at_unix_ms: 1000, raw_event_log: 'trace.jsonl', payloads_dir: 'payloads' }));
  await writeFile(join(directory, 'trace.jsonl'), events.map((payload, index) => JSON.stringify({ schema_version: 1, seq: index + 1, wall_time_unix_ms: 1000 + index, rollout_id: 'rollout-synthetic', thread_id: sessionId, codex_turn_id: 'turn-synthetic', payload })).join('\n') + '\n');
  for (const [index, value] of values.entries()) await writeFile(join(directory, 'payloads', `${index + 1}.json`), JSON.stringify(value));
});
function runner(transform = graph): ReducerRunner {
  return async (snapshot, output) => {
    expect(snapshot).not.toBe(directory);
    expect(await readFile(join(snapshot, 'payloads', '3.json'), 'utf8')).toBe(JSON.stringify(values[2]));
    await writeFile(output, JSON.stringify(transform()));
  };
}
test('uses native logical IDs to restore exact original call and result bodies', async () => {
  const reduced = await reduceTraceRequest(directory, identity, runner());
  expect(reduced.input).toEqual([first, call, result]);
  expect(reduced.notes.join(' ')).toContain('native reducer');
});
test('partial trailing JSONL is excluded from the immutable snapshot', async () => {
  const log = await readFile(join(directory, 'trace.jsonl'), 'utf8');
  await writeFile(join(directory, 'trace.jsonl'), log + '{"partial');
  expect((await reduceTraceRequest(directory, identity, runner())).input).toHaveLength(3);
});
test('snapshot rejects external payload references before launching a reducer', async () => {
  const log = (await readFile(join(directory, 'trace.jsonl'), 'utf8')).replace('payloads/1.json', '../outside.json');
  await writeFile(join(directory, 'trace.jsonl'), log);
  let ran = false;
  await expect(reduceTraceRequest(directory, identity, async () => { ran = true; })).rejects.toThrow();
  expect(ran).toBe(false);
});
test('snapshot refuses payload symlinks', async () => {
  const { unlink } = await import('node:fs/promises');
  await unlink(join(directory, 'payloads', '2.json'));
  await writeFile(join(directory, 'outside.json'), '{}');
  await symlink(join(directory, 'outside.json'), join(directory, 'payloads', '2.json'));
  await expect(reduceTraceRequest(directory, identity, runner())).rejects.toThrow(/symlink/);
});
test('a different root session or missing logical item is refused', async () => {
  await expect(reduceTraceRequest(directory, { ...identity, sessionId: 'other' }, runner())).rejects.toThrow();
  await expect(reduceTraceRequest(directory, identity, runner(() => {
    const value = graph(); value.inference_calls['inference-2'].request_item_ids.push('unknown'); return value;
  }))).rejects.toThrow();
});
test('wrong native graph identity is refused', async () => {
  await expect(reduceTraceRequest(directory, identity, runner(() => ({ ...graph(), root_thread_id: 'other' })))).rejects.toThrow();
});
test('oversized reduced output is refused', async () => {
  await expect(reduceTraceRequest(directory, identity, async (_snapshot, output) => { await writeFile(output, 'x'.repeat(32 * 1024 * 1024 + 1)); })).rejects.toThrow(/limit/);
});
test.skipIf(process.env.CONTEXT_NATIVE_TESTS !== '1')('installed native reducer restores a synthetic previous-response chain', async () => {
  const reduced = await reduceTraceRequest(directory, identity);
  expect(reduced.input).toEqual([first, call, result]);
});
test('failed native execution removes its private snapshot', async () => {
  let copied = '';
  await expect(reduceTraceRequest(directory, identity, async snapshot => { copied = snapshot; throw new Error('synthetic failure'); })).rejects.toThrow('synthetic failure');
  const { lstat } = await import('node:fs/promises');
  await expect(lstat(copied)).rejects.toThrow();
});
test('excess payload references are refused before native execution', async () => {
  const lines = (await readFile(join(directory, 'trace.jsonl'), 'utf8')).trim().split('\n');
  const firstEvent = JSON.parse(lines[0]);
  firstEvent.payload.refs = Array.from({ length: 257 }, (_, index) => ref(index + 1, 'inference_request'));
  lines[0] = JSON.stringify(firstEvent);
  await writeFile(join(directory, 'trace.jsonl'), lines.join('\n') + '\n');
  let ran = false;
  await expect(reduceTraceRequest(directory, identity, async () => { ran = true; })).rejects.toThrow(/limit/);
  expect(ran).toBe(false);
});
test.skipIf(process.env.CONTEXT_NATIVE_TESTS !== '1')('collector reports the full native-reduced incremental request', async () => {
  const { rename } = await import('node:fs/promises');
  const { prepareTraceRoot, readCodex } = await import('./codex-native');
  const home = await mkdtemp(join(await realpath(tmpdir()), 'codex-native-chain-'));
  const root = (await prepareTraceRoot('thread-synthetic', home)).path;
  await rename(directory, join(root, 'trace-synthetic'));
  const report = await readCodex('thread-synthetic', sessionId, home);
  expect(report.kind).toBe('available');
  if (report.kind !== 'available') throw new Error(report.reason);
  expect(report.categories.map(category => category.id)).toEqual(['user', 'calls', 'results']);
  expect(report.notes.join(' ')).toContain('native reducer');
  expect(JSON.stringify(report)).not.toContain('Synthetic retained result.');
});
