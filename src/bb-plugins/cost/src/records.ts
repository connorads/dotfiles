/**
 * One model request read from a provider's own session log. Logs, not BB events, are the source:
 * every provider writes one usage line per request with its model, and the logs outlive BB's events.
 */
export const providers = ['claude-code', 'codex', 'antigravity', 'opencode', 'grok', 'gemini', 'pi', 'omp', 'hermes'] as const;
export type Provider = typeof providers[number];

/** Map a BB thread `providerId` (including ACP variants) to its canonical cost provider. */
export function canonicalProvider(providerId: string): Provider | undefined {
  if ((providers as readonly string[]).includes(providerId)) return providerId as Provider;
  if (providerId === 'acp-antigravity' || providerId.startsWith('acp-antigravity-') || providerId === 'antigravity-sandbox') return 'antigravity';
  if (providerId === 'acp-opencode') return 'opencode';
  if (providerId === 'acp-grok') return 'grok';
  if (providerId === 'acp-gemini' || providerId === 'gemini-cli') return 'gemini';
  if (providerId === 'acp-omp') return 'omp';
  if (providerId === 'acp-hermes-agent') return 'hermes';
  return undefined;
}
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

/** What a parser carries between chunks of one file: session/model state, and watermarks for rewritten sources. */
export interface FileContext {
  sessionId?: string; cwd?: string; model?: string; speed?: Speed; skipLine?: boolean;
  mtimeMs?: number; sinceMs?: number;
}

/** A turn someone started: a person's message, or a message BB or a parent agent sent. Thread length counts these. */
export interface Turn { key: string; sessionId: string; at: number }

/** `sessions` maps each session seen to its working directory, which names usage outside BB threads. */
export interface ParseResult { consumed: number; context: FileContext; records: UsageRecord[]; turns: Turn[]; sessions: Record<string, string> }

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

export function piStep(line: Json, context: FileContext, provider: 'pi' | 'omp' = 'pi'): UsageRecord | null {
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
  const reasoning = count(usage.reasoning) || count(usage.reasoningTokens);
  return { key: `${provider}:${id}`, provider, sessionId: context.sessionId, at, model,
    input: count(usage.input), cacheRead: count(usage.cacheRead), cacheWrite5m: count(usage.cacheWrite), cacheWrite1h: 0,
    output, reasoning: Math.min(output, reasoning), speed: 'standard', webSearches: 0 };
}

export function antigravityStep(line: Json, context: FileContext): UsageRecord | null {
  if (line.type !== 'PLANNER_RESPONSE') return null;
  const model = text(line.model);
  const at = time(line.created_at);
  const stepIndex = typeof line.step_index === 'number' && Number.isFinite(line.step_index) ? line.step_index : undefined;
  if (!model || at === undefined || stepIndex === undefined || !context.sessionId) return null;
  // Antigravity reports uncached input, cache reads and total output (including thinking) separately.
  const input = count(line.input_tokens);
  const cacheRead = count(line.cache_read_tokens);
  const output = count(line.output_tokens);
  if (input + cacheRead + output === 0) return null;
  return { key: `antigravity:${context.sessionId}:${stepIndex}`, provider: 'antigravity', sessionId: context.sessionId, at, model,
    input, cacheRead, cacheWrite5m: 0, cacheWrite1h: 0, output, reasoning: 0, speed: 'standard', webSearches: 0 };
}

export function geminiStep(line: Json, context: FileContext): UsageRecord | null {
  if (typeof line.sessionId === 'string' && line.sessionId) {
    context.sessionId = line.sessionId;
    return null;
  }
  if (line.type === 'gemini') {
    const model = text(line.model);
    if (model) context.model = model;
  }
  if (line.type !== 'gemini' && line.type !== 'message_update') return null;
  const tokens = object(line.tokens);
  const model = text(line.model) ?? context.model;
  const at = time(line.timestamp);
  if (!tokens || !model || !context.sessionId || at === undefined) return null;
  // Gemini CLI's `input` includes `cached`, while `thoughts` are separate from `output` and bill at output rate.
  const cached = count(tokens.cached);
  const input = Math.max(0, count(tokens.input) - cached);
  const thoughts = count(tokens.thoughts);
  const output = count(tokens.output) + thoughts;
  if (input + cached + output === 0) return null;
  const id = text(line.id) ?? String(at);
  return { key: `gemini:${context.sessionId}:${id}`, provider: 'gemini', sessionId: context.sessionId, at, model,
    input, cacheRead: cached, cacheWrite5m: 0, cacheWrite1h: 0, output, reasoning: thoughts, speed: 'standard', webSearches: 0 };
}

/** Parse a monolithic Gemini CLI `session-*.json` file. */
export function parseGeminiJson(raw: unknown, cwd?: string): Omit<ParseResult, 'consumed' | 'context'> {
  const root = object(raw);
  const sessionId = text(root?.sessionId);
  const messages = Array.isArray(root?.messages) ? root.messages : [];
  if (!sessionId) return { records: [], turns: [], sessions: {} };
  const context: FileContext = { sessionId, cwd };
  const records: UsageRecord[] = [];
  const turns: Turn[] = [];
  for (const item of messages) {
    const entry = object(item);
    if (!entry) continue;
    const turn = geminiTurn(entry, context);
    if (turn) { turns.push(turn); continue; }
    const record = geminiStep(entry, context);
    if (record) records.push(record);
  }
  return { records, turns, sessions: cwd && records.length ? { [sessionId]: cwd } : {} };
}

/** Parse a Grok Build `usage.json` file; `inputTokens` includes cached reads and `outputTokens` includes reasoning. */
export function parseGrokUsage(raw: unknown, cwd?: string): Omit<ParseResult, 'consumed' | 'context'> {
  const root = object(raw);
  const sessionId = text(root?.sessionId);
  if (!sessionId) return { records: [], turns: [], sessions: {} };
  const fallbackAt = time(root?.updatedAt);
  const records: UsageRecord[] = [];
  const turns: Turn[] = [];
  const pushModels = (modelUsage: Json | undefined, prefix: string, at: number | undefined) => {
    if (!modelUsage || at === undefined) return;
    for (const [model, entry] of Object.entries(modelUsage)) {
      const usage = object(entry);
      if (!usage || !model) continue;
      const cached = count(usage.cachedReadTokens);
      const written = count(usage.cacheCreationTokens);
      const input = Math.max(0, count(usage.inputTokens) - cached - written);
      const output = count(usage.outputTokens);
      if (input + cached + written + output === 0) continue;
      records.push({
        key: `grok:${sessionId}:${prefix}:${model}`, provider: 'grok', sessionId, at, model,
        input, cacheRead: cached, cacheWrite5m: written, cacheWrite1h: 0,
        output, reasoning: Math.min(output, count(usage.reasoningTokens)), speed: 'standard', webSearches: 0,
      });
    }
  };
  const turnList = Array.isArray(root?.turns) ? root.turns : [];
  if (turnList.length > 0) {
    for (let index = 0; index < turnList.length; index += 1) {
      const turn = object(turnList[index]);
      if (!turn) continue;
      const num = typeof turn.turnNumber === 'number' && Number.isFinite(turn.turnNumber) ? turn.turnNumber : index + 1;
      const at = time(turn.endedAt) ?? fallbackAt;
      if (at !== undefined) turns.push({ key: `grok:${sessionId}:t${num}`, sessionId, at });
      pushModels(object(turn.modelUsage), `t${num}`, at);
    }
  } else {
    pushModels(object(object(root?.session)?.modelUsage), 'session', fallbackAt);
  }
  return { records, turns, sessions: cwd && records.length ? { [sessionId]: cwd } : {} };
}

function claudeTurn(line: Json): Turn | null {
  if (line.type !== 'user' || line.isSidechain || line.isMeta) return null;
  const content = object(line.message)?.content;
  const words = typeof content === 'string' ? content
    : Array.isArray(content) ? content.map(part => object(part)).find(part => part?.type === 'text')?.text : undefined;
  // Tool results arrive as user lines with no text; command echoes and caveats start with a tag.
  const uuid = text(line.uuid), sessionId = text(line.sessionId), at = time(line.timestamp);
  if (typeof words !== 'string' || !words.trim() || words.startsWith('<') || !uuid || !sessionId || at === undefined) return null;
  return { key: `claude:${uuid}`, sessionId, at };
}

function codexTurn(line: Json, context: FileContext): Turn | null {
  const payload = object(line.payload);
  if (line.type !== 'event_msg' || payload?.type !== 'task_started') return null;
  const attribution = object(payload.turn_attribution);
  // A turn with a parent is one agent prompting another inside the same request chain, not a new message.
  if (attribution?.parent_turn_id) return null;
  const id = text(attribution?.turn_id), at = time(line.timestamp);
  return id && context.sessionId && at !== undefined ? { key: `codex:${id}`, sessionId: context.sessionId, at } : null;
}

function piTurn(line: Json, context: FileContext, provider: 'pi' | 'omp' = 'pi'): Turn | null {
  const message = object(line.message);
  const at = time(message?.timestamp) ?? time(line.timestamp);
  if (line.type !== 'message' || message?.role !== 'user' || !context.sessionId || at === undefined) return null;
  // Entry ids repeat in forks, which copy their parent's entries; the id and time together name one message.
  return { key: `${provider}:${text(line.id) ?? ''}:${at}`, sessionId: context.sessionId, at };
}

function antigravityTurn(line: Json, context: FileContext): Turn | null {
  if (line.type !== 'USER_INPUT' || line.source !== 'USER_EXPLICIT') return null;
  const stepIndex = typeof line.step_index === 'number' && Number.isFinite(line.step_index) ? line.step_index : undefined;
  const at = time(line.created_at);
  return stepIndex !== undefined && context.sessionId && at !== undefined
    ? { key: `antigravity:${context.sessionId}:${stepIndex}`, sessionId: context.sessionId, at } : null;
}

function geminiTurn(line: Json, context: FileContext): Turn | null {
  if (line.type !== 'user' || !context.sessionId) return null;
  const content = line.content;
  const words = typeof content === 'string' ? content
    : Array.isArray(content) ? content.map(part => object(part)).find(part => typeof part?.text === 'string')?.text : undefined;
  if (typeof words === 'string' && words.trimStart().startsWith('<session_context>')) return null;
  const at = time(line.timestamp);
  if (at === undefined) return null;
  return { key: `gemini:${context.sessionId}:${text(line.id) ?? at}`, sessionId: context.sessionId, at };
}

// Cheap substring gates: most lines are tool output, and JSON.parse dominates a full scan.
const gates: Record<Provider, (line: string) => boolean> = {
  // User lines carrying tool results are most of a transcript's bytes and never start a turn.
  'claude-code': line => (line.includes('"usage"') && line.includes('"assistant"'))
    || (line.includes('"type":"user"') && !line.includes('"tool_result"')),
  codex: line => line.includes('"token_usage_record"') || line.includes('"turn_context"') || line.includes('"session_meta"')
    || line.includes('"task_started"'),
  antigravity: line => line.includes('"PLANNER_RESPONSE"') || line.includes('"USER_INPUT"'),
  opencode: () => false,
  grok: () => false,
  gemini: line => line.includes('"sessionId"') || line.includes('"tokens"') || line.includes('"type":"gemini"') || line.includes('"type":"user"'),
  pi: line => line.includes('"usage"') || line.includes('"type":"session"') || line.includes('"role":"user"'),
  omp: line => line.includes('"usage"') || line.includes('"type":"session"') || line.includes('"role":"user"'),
  hermes: () => false,
};

function parseTurn(provider: Provider, value: Json, context: FileContext): Turn | null {
  switch (provider) {
    case 'claude-code': return claudeTurn(value);
    case 'codex': return codexTurn(value, context);
    case 'antigravity': return antigravityTurn(value, context);
    case 'gemini': return geminiTurn(value, context);
    case 'pi': return piTurn(value, context, 'pi');
    case 'omp': return piTurn(value, context, 'omp');
    default: return null;
  }
}

function parseRecord(provider: Provider, value: Json, context: FileContext): UsageRecord | null {
  switch (provider) {
    case 'claude-code': return claudeRecord(value);
    case 'codex': return codexStep(value, context);
    case 'antigravity': return antigravityStep(value, context);
    case 'gemini': return geminiStep(value, context);
    case 'pi': return piStep(value, context, 'pi');
    case 'omp': return piStep(value, context, 'omp');
    default: return null;
  }
}

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
    if (newline < 0) return { consumed: full ? chunk.length : 0, context, records: [], turns: [], sessions: {} };
    start = newline + 1;
    delete context.skipLine;
  }
  const end = chunk.lastIndexOf(0x0a) + 1;
  if (end <= start) {
    if (full) context.skipLine = true;
    return { consumed: full ? chunk.length : start, context, records: [], turns: [], sessions: {} };
  }
  const records: UsageRecord[] = [];
  const turns: Turn[] = [];
  const sessions: Record<string, string> = {};
  const gate = gates[provider];
  for (const line of chunk.subarray(start, end).toString('utf8').split('\n')) {
    if (!line || !gate(line)) continue;
    let value: Json | undefined;
    try { value = object(JSON.parse(line)); } catch { continue; }
    if (!value) continue;
    const turn = parseTurn(provider, value, context);
    if (turn) { turns.push(turn); continue; }
    const record = parseRecord(provider, value, context);
    if (!record) continue;
    records.push(record);
    const cwd = provider === 'claude-code' ? text(value.cwd) : context.cwd;
    if (cwd) sessions[record.sessionId] = cwd;
  }
  return { consumed: end, context, records, turns, sessions };
}

export const totalTokens = (r: Pick<UsageRecord, 'input' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h' | 'output'>) =>
  r.input + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h + r.output;
