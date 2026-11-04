/**
 * One model request read from a provider's own session log. Logs, not BB events, are the source:
 * every provider writes one usage line per request with its model, and the logs outlive BB's events.
 */
export const providers = ['claude-code', 'codex', 'pi'] as const;
export type Provider = typeof providers[number];
// Priced at the provider's fast or priority rates when the log says so.
export type Speed = 'standard' | 'fast';

export interface UsageRecord {
  /** Unique per request across every file, so forks, resumes and rewritten lines count once. */
  key: string;
  provider: Provider;
  sessionId: string;
  at: number;
  model: string;
  /** Input not read from or written to cache. */
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  /** Includes reasoning tokens, which bill at the output rate. */
  output: number;
  reasoning: number;
  speed: Speed;
  webSearches: number;
}

/** What a parser carries between chunks of one file: Codex and Pi name the session and model once, early. */
export interface FileContext { sessionId?: string; cwd?: string; model?: string; speed?: Speed; skipLine?: boolean }

/** `sessions` maps each session seen to its working directory, which names usage outside BB threads. */
export interface ParseResult { consumed: number; context: FileContext; records: UsageRecord[]; sessions: Record<string, string> }

type Json = Record<string, unknown>;
const object = (value: unknown): Json | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
const text = (value: unknown) => typeof value === 'string' && value ? value : undefined;
const time = (value: unknown) => {
  const at = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : undefined;
};

export function claudeRecord(line: Json): UsageRecord | null {
  if (line.type !== 'assistant') return null;
  const message = object(line.message);
  const usage = object(message?.usage);
  const model = text(message?.model);
  const id = text(message?.id);
  const sessionId = text(line.sessionId);
  const at = time(line.timestamp);
  if (!usage || !model || model === '<synthetic>' || !id || !sessionId || at === undefined) return null;
  const written = count(usage.cache_creation_input_tokens);
  const tiers = object(usage.cache_creation);
  const hour = Math.min(written, count(tiers?.ephemeral_1h_input_tokens));
  return {
    // Claude Code writes one line per content block and replays parents in forks and subagents.
    key: `claude:${id}:${text(line.requestId) ?? ''}`,
    provider: 'claude-code', sessionId, at, model,
    input: count(usage.input_tokens), cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite5m: written - hour, cacheWrite1h: hour,
    output: count(usage.output_tokens), reasoning: 0,
    speed: usage.speed === 'fast' ? 'fast' : 'standard',
    webSearches: count(object(usage.server_tool_use)?.web_search_requests),
  };
}

function codexUsage(usage: Json) {
  const cached = count(usage.cached_input_tokens);
  const written = count(usage.cache_write_input_tokens);
  // Codex counts cached and written tokens inside input_tokens, and reasoning inside output_tokens.
  return { input: Math.max(0, count(usage.input_tokens) - cached - written), cacheRead: cached, cacheWrite5m: written,
    cacheWrite1h: 0, output: count(usage.output_tokens), reasoning: count(usage.reasoning_output_tokens) };
}
const codexSpeed = (tier: unknown): Speed | undefined =>
  tier === 'priority' || tier === 'fast' ? 'fast' : typeof tier === 'string' ? 'standard' : undefined;

export function codexStep(line: Json, context: FileContext): UsageRecord | null {
  const payload = object(line.payload);
  if (!payload) return null;
  if (line.type === 'session_meta') {
    context.sessionId = text(payload.id) ?? context.sessionId;
    const cwd = text(payload.cwd);
    if (cwd) context.cwd = cwd;
    return null;
  }
  if (line.type === 'turn_context') {
    context.model = text(payload.model) ?? context.model;
    context.speed = codexSpeed(payload.service_tier) ?? context.speed;
    return null;
  }
  if (line.type !== 'token_usage_record') return null;
  const usage = object(payload.usage);
  const id = text(payload.response_id);
  const sessionId = text(payload.session_id) ?? context.sessionId;
  const at = time(line.timestamp);
  if (!usage || !id || !sessionId || !context.model || at === undefined) return null;
  return { key: `codex:${id}`, provider: 'codex', sessionId, at, model: context.model, ...codexUsage(usage),
    speed: context.speed ?? 'standard', webSearches: 0 };
}

export function piStep(line: Json, context: FileContext): UsageRecord | null {
  if (line.type === 'session') {
    context.sessionId = text(line.id) ?? context.sessionId;
    const cwd = text(line.cwd);
    if (cwd) context.cwd = cwd;
    return null;
  }
  const message = object(line.message);
  const usage = object(message?.usage);
  const model = text(message?.model);
  const at = time(message?.timestamp) ?? time(line.timestamp);
  if (line.type !== 'message' || message?.role !== 'assistant' || !usage || !model || !context.sessionId || at === undefined) return null;
  // A forked session copies its parent's entries; the provider's response id is shared, so they count once.
  const id = text(message.responseId) ?? `${context.sessionId}:${text(line.id) ?? at}`;
  const output = count(usage.output);
  return { key: `pi:${id}`, provider: 'pi', sessionId: context.sessionId, at, model,
    input: count(usage.input), cacheRead: count(usage.cacheRead), cacheWrite5m: count(usage.cacheWrite), cacheWrite1h: 0,
    output, reasoning: Math.min(output, count(usage.reasoning)), speed: 'standard', webSearches: 0 };
}

// Cheap substring gates: most lines are tool output, and JSON.parse dominates a full scan.
const gates: Record<Provider, (line: string) => boolean> = {
  'claude-code': line => line.includes('"usage"') && line.includes('"assistant"'),
  codex: line => line.includes('"token_usage_record"') || line.includes('"turn_context"') || line.includes('"session_meta"'),
  pi: line => line.includes('"usage"') || line.includes('"type":"session"'),
};

/**
 * Parse the complete lines of a chunk read from `offset`. Returns the bytes consumed so a partly
 * written last line is read again next time. A full chunk with no newline is one oversized line:
 * it is consumed and skipped to its end, since usage lines are small.
 */
export function parseChunk(provider: Provider, chunk: Buffer, previous: FileContext, full: boolean): ParseResult {
  const context = { ...previous };
  let start = 0;
  if (context.skipLine) {
    const newline = chunk.indexOf(0x0a);
    if (newline < 0) return { consumed: full ? chunk.length : 0, context, records: [], sessions: {} };
    start = newline + 1;
    delete context.skipLine;
  }
  const end = chunk.lastIndexOf(0x0a) + 1;
  if (end <= start) {
    if (full) context.skipLine = true;
    return { consumed: full ? chunk.length : start, context, records: [], sessions: {} };
  }
  const records: UsageRecord[] = [];
  const sessions: Record<string, string> = {};
  const gate = gates[provider];
  for (const line of chunk.subarray(start, end).toString('utf8').split('\n')) {
    if (!line || !gate(line)) continue;
    let value: Json | undefined;
    try { value = object(JSON.parse(line)); } catch { continue; }
    if (!value) continue;
    const record = provider === 'claude-code' ? claudeRecord(value) : provider === 'codex' ? codexStep(value, context) : piStep(value, context);
    if (!record) continue;
    records.push(record);
    const cwd = provider === 'claude-code' ? text(value.cwd) : context.cwd;
    if (cwd) sessions[record.sessionId] = cwd;
  }
  return { consumed: end, context, records, sessions };
}

export const totalTokens = (r: Pick<UsageRecord, 'input' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h' | 'output'>) =>
  r.input + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h + r.output;
