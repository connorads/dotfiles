import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const maxLogBytes = 4 * 1024 * 1024;
const maxPayloadBytes = 8 * 1024 * 1024;
const maxSnapshotBytes = 64 * 1024 * 1024;
const maxReducedBytes = 32 * 1024 * 1024;
const object = z.record(z.string(), z.unknown());
const payloadRef = z.object({ raw_payload_id: z.string().min(1).max(160), path: z.string().regex(/^payloads\/[0-9]+\.json$/), kind: z.object({ type: z.string().max(80) }) });
const manifestSchema = z.object({ schema_version: z.literal(1), trace_id: z.string(), rollout_id: z.string(), root_thread_id: z.string(),
  started_at_unix_ms: z.number().finite(), raw_event_log: z.literal('trace.jsonl'), payloads_dir: z.literal('payloads') });
const inferenceSchema = z.object({ thread_id: z.string(), execution: z.object({ started_seq: z.number().finite() }),
  request_item_ids: z.array(z.string()).max(10000), response_item_ids: z.array(z.string()).max(10000),
  raw_request_payload_id: z.string(), raw_response_payload_id: z.string().nullable() });
const graphSchema = z.object({ schema_version: z.literal(1), root_thread_id: z.string(),
  inference_calls: z.record(z.string(), inferenceSchema), conversation_items: z.record(z.string(), z.object({ thread_id: z.string() })) });
export type ReducerRunner = (snapshot: string, output: string) => Promise<void>;
const execute = promisify(execFile);

export async function refuseTraceSymlinks(path: string) {
  for (let current = path; current !== parse(current).root; current = dirname(current)) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Trace path contains a symlink.');
  }
}
export async function readTraceFile(path: string, limit: number) {
  await refuseTraceSymlinks(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('Trace file exceeds the read limit or is not regular.');
    const bytes = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await file.stat();
    if (length > limit || length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('Trace changed during read. Try again.');
    return { text: bytes.subarray(0, length).toString('utf8'), modified: stat.mtimeMs };
  } finally { await file.close(); }
}
async function runNativeReducer(snapshot: string, output: string) {
  await execute('codex', ['debug', 'trace-reduce', snapshot, '--output', output], {
    timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true,
  });
}
function referencedPayloads(events: unknown[]) {
  const references = new Map<string, string>();
  const pending = [...events];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) { pending.push(...value); continue; }
    const parsed = object.safeParse(value);
    if (!parsed.success) continue;
    if ('raw_payload_id' in parsed.data) {
      const reference = payloadRef.parse(value);
      const previous = references.get(reference.raw_payload_id);
      if (previous !== undefined && previous !== reference.path) throw new Error('Conflicting native payload identity.');
      references.set(reference.raw_payload_id, reference.path);
      if (references.size > 256) throw new Error('Trace payload count exceeds snapshot limit.');
    }
    pending.push(...Object.values(parsed.data));
  }
  return references;
}
async function snapshotBundle(source: string, identity: { sessionId: string; inferenceId: string }, destination: string) {
  const manifest = manifestSchema.parse(JSON.parse((await readTraceFile(join(source, 'manifest.json'), 64 * 1024)).text));
  if (manifest.root_thread_id !== identity.sessionId) throw new Error('Native trace session changed.');
  const log = (await readTraceFile(join(source, 'trace.jsonl'), maxLogBytes)).text;
  const committed = log.slice(0, log.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map((line): unknown => JSON.parse(line));
  const selected = committed.findIndex(raw => {
    const event = object.parse(raw);
    const payload = object.safeParse(event.payload);
    return payload.success && payload.data.type === 'inference_started' && payload.data.inference_call_id === identity.inferenceId && payload.data.thread_id === identity.sessionId;
  });
  if (selected < 0) throw new Error('Selected native inference is no longer present.');
  // End at the selected request. Later writer activity cannot change this prefix.
  const events = committed.slice(0, selected + 1);
  const refs = referencedPayloads(events);
  let totalBytes = Buffer.byteLength(log, 'utf8');
  const payloads = new Map<string, unknown>();
  await mkdir(join(destination, 'payloads'), { mode: 0o700 });
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
  await writeFile(join(destination, 'trace.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n', { mode: 0o600 });
  for (const [id, path] of refs) {
    const content = (await readTraceFile(join(source, path), maxPayloadBytes)).text;
    totalBytes += Buffer.byteLength(content, 'utf8');
    if (totalBytes > maxSnapshotBytes) throw new Error('Trace payload bytes exceed snapshot limit.');
    payloads.set(id, JSON.parse(content));
    await writeFile(join(destination, path), content, { mode: 0o600 });
  }
  return payloads;
}
function logicalInput(graphValue: unknown, payloads: Map<string, unknown>, identity: { sessionId: string; inferenceId: string }) {
  const graph = graphSchema.parse(graphValue);
  const selected = graph.inference_calls[identity.inferenceId];
  if (graph.root_thread_id !== identity.sessionId || selected?.thread_id !== identity.sessionId) throw new Error('Reduced native identity does not match.');
  const items = new Map<string, unknown>();
  let skippedDefinitions = false;
  function register(ids: string[], values: unknown[], incremental: boolean) {
    const included = values.filter(raw => {
      const parsed = object.safeParse(raw);
      if (parsed.success && parsed.data.type === 'additional_tools') { skippedDefinitions = true; return false; }
      return true;
    });
    if ((!incremental && ids.length !== included.length) || ids.length < included.length) throw new Error('Native logical item coverage does not match raw material.');
    const materialIds = included.length ? ids.slice(ids.length - included.length) : [];
    for (const [index, id] of materialIds.entries()) items.set(id, included[index]);
  }
  const inferences = Object.values(graph.inference_calls).filter(inference => inference.thread_id === identity.sessionId)
    .sort((a, b) => a.execution.started_seq - b.execution.started_seq);
  for (const inference of inferences) {
    const request = z.object({ input: z.array(z.unknown()), previous_response_id: z.unknown().optional() }).parse(payloads.get(inference.raw_request_payload_id));
    register(inference.request_item_ids, request.input, request.previous_response_id != null);
    if (inference.raw_response_payload_id !== null) {
      const response = z.object({ output_items: z.array(z.unknown()) }).parse(payloads.get(inference.raw_response_payload_id));
      register(inference.response_item_ids, response.output_items, false);
    }
  }
  const input = selected.request_item_ids.map(id => {
    if (!items.has(id) || graph.conversation_items[id]?.thread_id !== identity.sessionId) throw new Error('Reduced request contains unsupported or missing logical material.');
    return items.get(id);
  });
  // Native graph deliberately omits additional_tools items. Preserve partial coverage.
  if (skippedDefinitions) input.push({ type: 'additional_tools' });
  return { request: payloads.get(selected.raw_request_payload_id), input, notes: ['Retained input restored by the installed native reducer; estimates use original recorded item bodies.',
    ...(skippedDefinitions ? ['Native reduced input omits additional tool-definition items; those costs are unavailable.'] : [])] };
}
/** Native code decides retained ordering; this adapter only resolves its IDs to raw items. */
export async function reduceTraceRequest(source: string, identity: { sessionId: string; inferenceId: string }, run: ReducerRunner = runNativeReducer) {
  const snapshot = await mkdtemp(join(await realpath(tmpdir()), 'bb-context-reduce-'));
  try {
    const payloads = await snapshotBundle(source, identity, snapshot);
    const output = join(snapshot, 'state.json');
    await run(snapshot, output);
    return logicalInput(JSON.parse((await readTraceFile(output, maxReducedBytes)).text), payloads, identity);
  } finally { await rm(snapshot, { recursive: true, force: true }); }
}
