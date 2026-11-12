import { beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, lstat, symlink, readdir, utimes, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareTraceRoot, readCodex, purgeCodex } from './codex-native';

let home: string;
beforeEach(async () => { home = await mkdtemp(join(await realpath(tmpdir()), 'native-counts-')); });
const threadId = 'thread-synthetic';
const sessionId = 'native-session';
const message = (text: string, role = 'user') => ({ type: 'message', role, content: [{ type: 'input_text', text }] });
async function bundle(request: unknown, options: { name?: string; session?: string; complete?: boolean; tail?: string; time?: number } = {}) {
  const root = (await prepareTraceRoot(threadId, home)).path;
  const path = join(root, options.name ?? 'trace-synthetic');
  await mkdir(join(path, 'payloads'), { recursive: true });
  await writeFile(join(path, 'manifest.json'), JSON.stringify({ schema_version: 2, root_thread_id: options.session ?? sessionId, started_at_unix_ms: options.time ?? 1000 }));
  const event = { schema_version: 2, wall_time_unix_ms: options.time ?? 1000, thread_id: options.session ?? sessionId,
    payload: { type: 'inference_started', inference_call_id: 'request-synthetic', thread_id: options.session ?? sessionId, request_payload: { path: 'payloads/1.json' } } };
  await writeFile(join(path, 'trace.jsonl'), `${JSON.stringify(event)}\n${options.complete ? `${JSON.stringify({ payload: { type: 'rollout_ended' } })}\n` : ''}${options.tail ?? ''}`);
  await writeFile(join(path, 'payloads', '1.json'), JSON.stringify(request));
  return path;
}
test('creates private thread-local root and refuses unsafe thread keys', async () => {
  const { path } = await prepareTraceRoot(threadId, home);
  expect(path).toBe(join(home, '.bb', 'context-inspector', 'traces', threadId));
  expect((await lstat(path)).mode & 0o777).toBe(0o700);
  await expect(prepareTraceRoot('../elsewhere', home)).rejects.toThrow();
});
test('counts request material without returning raw text or inferred owners', async () => {
  await bundle({ input: [message('hello'), message('😀😀', 'developer')], tools: [{ type: 'function', name: 'synthetic_tool', parameters: {} }] });
  const report = await readCodex(threadId, sessionId, home);
  expect(report.kind).toBe('available');
  if (report.kind !== 'available') throw new Error(report.reason);
  expect(report.scope).toBe('last-request');
  expect(report.categories.find(c => c.id === 'user')).toMatchObject({ tokens: 2 });
  expect(report.categories.find(c => c.id === 'developer')).toMatchObject({ tokens: 2 });
  expect(JSON.stringify(report)).not.toContain('hello');
  expect(JSON.stringify(report)).not.toContain('😀');
  expect(report.notes.join(' ')).toContain('attempted');
});
test('counts calls and string results and names unsupported material', async () => {
  await bundle({ input: [
    { type: 'function_call', name: 'tool', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call', output: 'abcdefgh' },
    { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'synthetic' }] },
  ] });
  const report = await readCodex(threadId, sessionId, home);
  if (report.kind !== 'available') throw new Error(report.reason);
  expect(report.categories.find(c => c.id === 'calls')?.tokens).toBe(4);
  expect(report.categories.find(c => c.id === 'results')?.tokens).toBe(3);
  expect(report.notes.join(' ')).toContain('1 unsupported');
});
test('never joins another native session or child thread', async () => {
  await bundle({ input: [message('test')] }, { session: 'other-session' });
  expect(await readCodex(threadId, sessionId, home)).toMatchObject({ kind: 'unavailable' });
});
test('refuses legacy trace manifests', async () => {
  const path = await bundle({ input: [message('Synthetic legacy input.')] });
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
  manifest.schema_version = 1;
  await writeFile(join(path, 'manifest.json'), JSON.stringify(manifest));
  expect(await readCodex(threadId, sessionId, home)).toMatchObject({ kind: 'unavailable' });
});
test('reads latest native inference and tolerates incomplete final JSONL line', async () => {
  await bundle({ input: [message('first')] }, { name: 'trace-first', time: 1000 });
  await bundle({ input: [message('second-larger')] }, { name: 'trace-last', time: 2000, tail: '{"schema' });
  const report = await readCodex(threadId, sessionId, home);
  expect(report).toMatchObject({ kind: 'available', totalTokens: 4, capturedAt: '1970-01-01T00:00:02.000Z' });
});
test('incremental and unknown top-level material cannot silently appear complete', async () => {
  await bundle({ previous_response_id: 'prior', input: [message('delta')] });
  expect(await readCodex(threadId, sessionId, home)).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('incremental') });
});
test('symlink ancestors and request payloads are refused', async () => {
  const path = await bundle({ input: [message('safe')] });
  const { unlink } = await import('node:fs/promises');
  await unlink(join(path, 'payloads', '1.json'));
  await writeFile(join(home, 'outside.json'), '{"input":[]}');
  await symlink(join(home, 'outside.json'), join(path, 'payloads', '1.json'));
  expect(await readCodex(threadId, sessionId, home)).toMatchObject({ kind: 'unavailable' });
  const secondHome = await mkdtemp(join(await realpath(tmpdir()), 'native-path-'));
  await symlink(join(home, '.bb'), join(secondHome, '.bb'));
  await expect(prepareTraceRoot(threadId, secondHome)).rejects.toThrow();
});
test('payload path traversal and oversized content are refused', async () => {
  const path = await bundle({ input: [] });
  const log = JSON.parse((await readFile(join(path, 'trace.jsonl'), 'utf8')).trim());
  log.payload.request_payload.path = '../outside.json';
  await writeFile(join(path, 'trace.jsonl'), JSON.stringify(log) + '\n');
  expect(await readCodex(threadId, sessionId, home)).toMatchObject({ kind: 'unavailable' });
  log.payload.request_payload.path = 'payloads/1.json';
  await writeFile(join(path, 'trace.jsonl'), JSON.stringify(log) + '\n');
  await writeFile(join(path, 'payloads', '1.json'), 'x'.repeat(8 * 1024 * 1024 + 1));
  expect(await readCodex(threadId, sessionId, home)).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('limit') });
});
test('purge refuses active traces and deletes only ended generated bundles', async () => {
  const path = await bundle({ input: [] });
  expect(await purgeCodex(threadId, home)).toEqual({ purged: false });
  await writeFile(join(path, 'trace.jsonl'), '{"payload":{"type":"rollout_ended"}}\n');
  expect(await purgeCodex(threadId, home)).toEqual({ purged: true });
  expect(await readdir((await prepareTraceRoot(threadId, home)).path)).toEqual([]);
});
test('prunes completed old bundles without pruning an active bundle', async () => {
  const ended = await bundle({ input: [] }, { name: 'trace-old', complete: true });
  const active = await bundle({ input: [message('active')] }, { name: 'trace-active' });
  const old = new Date(Date.now() - 2 * 86400000);
  await utimes(join(ended, 'trace.jsonl'), old, old);
  await readCodex(threadId, sessionId, home);
  expect(await lstat(active)).toBeTruthy();
  await expect(lstat(ended)).rejects.toThrow();
});

test('child-thread inference cannot replace the root session report', async () => {
  const path = await bundle({ input: [message('root')] });
  const log = await readFile(join(path, 'trace.jsonl'), 'utf8');
  const child = JSON.parse(log.trim());
  child.thread_id = 'native-child'; child.payload.thread_id = 'native-child';
  child.payload.request_payload.path = 'payloads/2.json'; child.wall_time_unix_ms = 3000;
  await writeFile(join(path, 'payloads', '2.json'), JSON.stringify({ input: [message('wrong source')] }));
  await writeFile(join(path, 'trace.jsonl'), log + JSON.stringify(child) + '\n');
  expect(await readCodex(threadId, sessionId, home)).toMatchObject({ kind: 'available', totalTokens: 1 });
});
test('retention keeps at most three completed bundles', async () => {
  for (let i = 0; i < 5; i++) await bundle({ input: [] }, { name: `trace-${i}`, complete: true });
  await readCodex(threadId, sessionId, home);
  expect(await readdir((await prepareTraceRoot(threadId, home)).path)).toHaveLength(3);
});

test('wholly unsupported material is unavailable rather than a zero-token claim', async () => {
  await bundle({ input: [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'synthetic' }] }] });
  expect(await readCodex(threadId, sessionId, home)).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('supported') });
});
test('concurrent environment resolution creates one private trace root', async () => {
  const roots = await Promise.all(Array.from({ length: 5 }, () => prepareTraceRoot(threadId, home)));
  expect(new Set(roots.map(root => root.path)).size).toBe(1);
});
