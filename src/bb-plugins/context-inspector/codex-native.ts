import { chmod, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse } from 'node:path';
import { z } from 'zod';
import { nativeResult, threadKey, type NativeReport, type NativeResult } from './native-contract';
import { readTraceFile as readBounded, refuseTraceSymlinks as refuseSymlinks, reduceTraceRequest } from './codex-reducer';

const maxLogBytes = 4 * 1024 * 1024;
const maxPayloadBytes = 8 * 1024 * 1024;
const day = 86400000;
const object = z.record(z.string(), z.unknown());
const manifestSchema = z.object({ schema_version: z.literal(2), root_thread_id: z.string() });
const eventSchema = z.object({
  schema_version: z.literal(2), wall_time_unix_ms: z.number().finite().nonnegative(), thread_id: z.string().nullable(),
  payload: z.object({ type: z.literal('inference_started'), inference_call_id: z.string().min(1), thread_id: z.string(),
    request_payload: z.object({ path: z.string().regex(/^payloads\/[0-9]+\.json$/) }),
  }),
});
const requestSchema = z.object({ input: z.array(z.unknown()).max(10000), tools: z.array(z.unknown()).max(10000).optional(), instructions: z.string().optional(), previous_response_id: z.unknown().optional() });
type Inference = z.infer<typeof eventSchema>;
type Bundle = { path: string; sessionId: string; modified: number; ended: boolean; event: Inference | null };

/** Directory inputs stay host-local; only a validated BB thread key crosses RPC. */
function tracePath(threadId: string, home: string) {
  threadKey.parse(threadId);
  if (!isAbsolute(home)) throw new Error('Trace home must be absolute.');
  return join(home, '.bb', 'context-inspector', 'traces', threadId);
}
export async function prepareTraceRoot(threadId: string, home = homedir()): Promise<{ path: string }> {
  const path = tracePath(threadId, home);
  const missing: string[] = [];
  for (let current = path; current !== parse(current).root; current = dirname(current)) {
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Trace parent must be a real directory.');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') missing.push(current);
      else throw error;
    }
  }
  for (const directory of missing.reverse()) {
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Trace parent must be a real directory.');
    }
  }
  await refuseSymlinks(path);
  await chmod(path, 0o700);
  return { path };
}
async function bundles(root: string): Promise<Bundle[]> {
  await refuseSymlinks(root);
  const directories = await readdir(root, { withFileTypes: true });
  if (directories.length > 32) throw new Error('Trace directory exceeds the bundle scan limit.');
  const result: Bundle[] = [];
  for (const directory of directories) {
    if (!/^trace-[a-zA-Z0-9_-]+$/.test(directory.name)) continue;
    if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error('Trace bundle must be a real directory.');
    const path = join(root, directory.name);
    const manifest = manifestSchema.parse(JSON.parse((await readBounded(join(path, 'manifest.json'), 64 * 1024)).text));
    const log = await readBounded(join(path, 'trace.jsonl'), maxLogBytes);
    const lines = log.text.split('\n');
    // The native writer appends JSONL. A final line without LF is not committed yet.
    lines.pop();
    let event: Inference | null = null;
    let ended = false;
    for (const line of lines) {
      if (!line) continue;
      const raw: unknown = JSON.parse(line);
      const value = object.parse(raw);
      const payload = object.safeParse(value.payload);
      if (payload.success && payload.data.type === 'rollout_ended') ended = true;
      if (payload.success && payload.data.type === 'inference_started') {
        const candidate = eventSchema.parse(raw);
        if (candidate.thread_id === manifest.root_thread_id && candidate.payload.thread_id === manifest.root_thread_id &&
          (!event || candidate.wall_time_unix_ms >= event.wall_time_unix_ms)) event = candidate;
      }
    }
    result.push({ path, sessionId: manifest.root_thread_id, modified: log.modified, ended, event });
  }
  return result;
}
async function prune(entries: Bundle[]) {
  const completed = entries.filter(entry => entry.ended).sort((a, b) => b.modified - a.modified);
  const removed = new Set<string>();
  for (const [index, entry] of completed.entries()) {
    if (index < 3 && Date.now() - entry.modified < day) continue;
    await refuseSymlinks(entry.path);
    await rm(entry.path, { recursive: true });
    removed.add(entry.path);
  }
  return entries.filter(entry => !removed.has(entry.path));
}
function project(request: z.infer<typeof requestSchema>, event: Inference): NativeResult {
  const categories = new Map<string, NativeReport['categories'][number]>();
  let unsupported = 0;
  let omittedEntries = 0;
  function add(id: string, label: string, entry: { id: string; label: string; bytes: number }) {
    const tokens = Math.ceil(entry.bytes / 4);
    let category = categories.get(id);
    if (!category) { category = { id, label, kind: 'used', tokens: 0, entries: [] }; categories.set(id, category); }
    category.tokens += tokens;
    if (category.entries.length < 500) category.entries.push({ id: entry.id, label: entry.label, tokens });
    else omittedEntries++;
  }
  const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
  if (request.instructions !== undefined) add('instructions', 'Top-level instructions', { id: 'instructions', label: 'Request instructions', bytes: bytes(request.instructions) });
  for (const [index, raw] of request.input.entries()) {
    const parsed = object.safeParse(raw);
    if (!parsed.success) { unsupported++; continue; }
    const item = parsed.data;
    if (item.type === 'message' && typeof item.role === 'string' && ['user', 'assistant', 'developer', 'system'].includes(item.role) && Array.isArray(item.content)) {
      const parts = z.array(z.object({ type: z.enum(['input_text', 'output_text']), text: z.string() })).safeParse(item.content);
      if (!parts.success) { unsupported++; continue; }
      const role = String(item.role);
      add(role, `${role.charAt(0).toUpperCase()}${role.slice(1)}-role input`, { id: `input:${index}`, label: `Input ${index + 1}`, bytes: parts.data.reduce((n, part) => n + bytes(part.text), 0) });
    } else if (item.type === 'function_call' && typeof item.name === 'string' && typeof item.arguments === 'string' && (item.namespace === undefined || typeof item.namespace === 'string')) {
      add('calls', 'Tool calls', { id: `input:${index}`, label: item.name.slice(0, 160), bytes: bytes(item.name) + bytes(item.arguments) + bytes(item.namespace ?? 'functions') });
    } else if (item.type === 'function_call_output' && typeof item.output === 'string') {
      const strings = [item.call_id, item.name, item.namespace];
      if (strings.some(value => value !== undefined && value !== null && typeof value !== 'string')) { unsupported++; continue; }
      add('results', 'Tool results', { id: `input:${index}`, label: `Tool result ${index + 1}`, bytes: bytes(item.output) + strings.reduce<number>((n, value) => n + (typeof value === 'string' ? bytes(value) : 0), 0) });
    } else unsupported++;
  }
  for (const [index, tool] of (request.tools ?? []).entries()) {
    const parsed = object.safeParse(tool);
    if (!parsed.success) { unsupported++; continue; }
    const label = typeof parsed.data.name === 'string' ? parsed.data.name.slice(0, 160) : `Definition ${index + 1}`;
    add('tools', 'Tool definitions', { id: `tool:${index}`, label, bytes: bytes(JSON.stringify(tool)) });
  }
  if (!categories.size && unsupported) return { kind: 'unavailable', reason: 'No supported request material could be estimated.' };
  return {
    kind: 'available', provider: 'codex', scope: 'last-request', capturedAt: new Date(event.wall_time_unix_ms).toISOString(),
    providerSessionId: event.payload.thread_id, requestId: event.payload.inference_call_id,
    method: 'UTF-8 bytes / 4, rounded per item; tool JSON approximation',
    totalTokens: [...categories.values()].reduce((sum, category) => sum + category.tokens, 0), categories: [...categories.values()],
    notes: ['Last attempted request material. This is an estimate, not provider usage or current occupancy.',
      'Input roles identify request positions, not file or plugin ownership. Provider framing is excluded.',
      ...(unsupported ? [`${unsupported} unsupported items are excluded; this report is partial.`] : []),
      ...(omittedEntries ? [`${omittedEntries} source rows omitted; category estimates include them.`] : [])],
  };
}
export async function readCodex(threadId: string, sessionId: string, home = homedir()): Promise<NativeResult> {
  try {
    const entries = await prune(await bundles(tracePath(threadId, home)));
    const selected = entries.filter(entry => entry.sessionId === sessionId && entry.event).sort((a, b) => (b.event?.wall_time_unix_ms ?? 0) - (a.event?.wall_time_unix_ms ?? 0))[0];
    if (!selected?.event) return { kind: 'unavailable', reason: 'No native request recorded for this session. Tracing starts with a new provider process.' };
    const raw = JSON.parse((await readBounded(join(selected.path, selected.event.payload.request_payload.path), maxPayloadBytes)).text);
    let request = requestSchema.parse(raw);
    let notes: string[] = [];
    if (request.previous_response_id != null) {
      try {
        const reduced = await reduceTraceRequest(selected.path, { sessionId, inferenceId: selected.event.payload.inference_call_id });
        request = requestSchema.parse(reduced.request);
        request.input = reduced.input;
        notes = reduced.notes;
      } catch { return { kind: 'unavailable', reason: 'Native incremental request reduction is unavailable for this trace. Check installed Codex reducer support or refresh.' }; }
    }
    const report = project(request, selected.event);
    if (report.kind === 'available') report.notes.push(...notes);
    return nativeResult.parse(report);
  } catch (error) {
    const known = error instanceof Error && /limit|symlink|changed during read/.test(error.message) ? error.message : 'Native trace is absent, incomplete or unsupported.';
    return { kind: 'unavailable', reason: known };
  }
}
export async function purgeCodex(threadId: string, home = homedir()): Promise<{ purged: boolean }> {
  try {
    const root = tracePath(threadId, home);
    const entries = await bundles(root);
    if (entries.some(entry => !entry.ended)) return { purged: false };
    for (const entry of entries) {
      await refuseSymlinks(entry.path);
      await rm(entry.path, { recursive: true });
    }
    return { purged: true };
  } catch { return { purged: false }; }
}
