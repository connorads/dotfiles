import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalProvider, parseChunk, parseGeminiJson, parseGrokUsage } from './records.ts';

const lines = (...values: unknown[]) => Buffer.from(values.map(value => JSON.stringify(value)).join('\n') + '\n');

const claude = (id: string, usage: object, extra: object = {}) => ({
  type: 'assistant', sessionId: 'sess-1', requestId: 'req-1', timestamp: '2026-11-01T10:00:00.000Z',
  message: { id, model: 'claude-opus-5-5', usage }, ...extra,
});

test('Claude Code splits 1-hour cache writes from 5-minute ones and reads fast mode and web searches', () => {
  const { records } = parseChunk('claude-code', lines(claude('msg_1', {
    input_tokens: 10, cache_read_input_tokens: 500, cache_creation_input_tokens: 300,
    cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
    output_tokens: 40, speed: 'fast', server_tool_use: { web_search_requests: 2 },
  })), {}, false);
  assert.deepEqual(records, [{
    key: 'claude:msg_1:req-1', provider: 'claude-code', sessionId: 'sess-1', at: Date.parse('2026-11-01T10:00:00.000Z'),
    model: 'claude-opus-5-5', input: 10, cacheRead: 500, cacheWrite5m: 100, cacheWrite1h: 200, output: 40, reasoning: 0,
    speed: 'fast', webSearches: 2,
  }]);
});

test('Claude Code keeps sidechain requests and skips synthetic and user lines', () => {
  const { records } = parseChunk('claude-code', lines(
    claude('msg_2', { input_tokens: 1, output_tokens: 1 }, { isSidechain: true }),
    { ...claude('msg_3', { input_tokens: 1, output_tokens: 1 }), message: { id: 'msg_3', model: '<synthetic>', usage: { input_tokens: 0 } } },
    { type: 'user', sessionId: 'sess-1', message: { role: 'user', content: 'usage' } },
  ), {}, false);
  assert.deepEqual(records.map(record => record.key), ['claude:msg_2:req-1']);
});

test('Codex takes the session and model from earlier lines and nets cached tokens out of input', () => {
  const first = parseChunk('codex', lines(
    { timestamp: '2026-11-01T10:00:00Z', type: 'session_meta', payload: { id: 'codex-1' } },
    { timestamp: '2026-11-01T10:00:01Z', type: 'turn_context', payload: { model: 'gpt-6.1-sol', service_tier: 'priority' } },
  ), {}, false);
  assert.deepEqual(first.context, { sessionId: 'codex-1', model: 'gpt-6.1-sol', speed: 'fast' });
  const { records } = parseChunk('codex', lines({
    timestamp: '2026-11-01T10:00:02Z', type: 'token_usage_record',
    payload: { response_id: 'resp_1', usage: { input_tokens: 1000, cached_input_tokens: 800, cache_write_input_tokens: 50,
      output_tokens: 70, reasoning_output_tokens: 20 } },
  }), first.context, false);
  assert.deepEqual(records, [{
    key: 'codex:resp_1', provider: 'codex', sessionId: 'codex-1', at: Date.parse('2026-11-01T10:00:02Z'), model: 'gpt-6.1-sol',
    input: 150, cacheRead: 800, cacheWrite5m: 50, cacheWrite1h: 0, output: 70, reasoning: 20, speed: 'fast', webSearches: 0,
  }]);
});

test('Pi keys requests by response id so a fork that copies its parent counts once', () => {
  const entry = (id: string) => ({ type: 'message', id, timestamp: '2026-11-01T10:00:00Z', message: {
    role: 'assistant', model: 'gpt-5.5', responseId: 'resp_9', timestamp: 1793530000000,
    usage: { input: 30, output: 12, cacheRead: 400, cacheWrite: 0, reasoning: 5 } } });
  const parent = parseChunk('pi', lines({ type: 'session', id: 'pi-parent' }, entry('a')), {}, false);
  const fork = parseChunk('pi', lines({ type: 'session', id: 'pi-fork' }, entry('b')), {}, false);
  assert.equal(parent.records[0]!.key, fork.records[0]!.key);
  assert.deepEqual({ ...parent.records[0], key: undefined }, { key: undefined, provider: 'pi', sessionId: 'pi-parent', at: 1793530000000,
    model: 'gpt-5.5', input: 30, cacheRead: 400, cacheWrite5m: 0, cacheWrite1h: 0, output: 12, reasoning: 5, speed: 'standard', webSearches: 0 });
});

test('a partly written last line is left for the next read', () => {
  const whole = lines(claude('msg_4', { input_tokens: 1, output_tokens: 1 }));
  const chunk = Buffer.concat([whole, Buffer.from('{"type":"assist')]);
  const result = parseChunk('claude-code', chunk, {}, false);
  assert.equal(result.consumed, whole.length);
  assert.equal(result.records.length, 1);
});

test('an oversized line is skipped to its end across reads', () => {
  const first = parseChunk('claude-code', Buffer.from('{"huge":"' + 'x'.repeat(100)), {}, true);
  assert.equal(first.consumed, 109);
  assert.equal(first.context.skipLine, true);
  const rest = Buffer.concat([Buffer.from('xxx"}\n'), lines(claude('msg_5', { input_tokens: 1, output_tokens: 1 }))]);
  const second = parseChunk('claude-code', rest, first.context, false);
  assert.equal(second.context.skipLine, undefined);
  assert.deepEqual(second.records.map(record => record.key), ['claude:msg_5:req-1']);
});

test('each session keeps the working directory its log names', () => {
  const claudeLine = { ...claude('msg_6', { input_tokens: 1, output_tokens: 1 }), cwd: '/work/app' };
  assert.deepEqual(parseChunk('claude-code', lines(claudeLine), {}, false).sessions, { 'sess-1': '/work/app' });
  const codex = parseChunk('codex', lines(
    { timestamp: '2026-11-01T10:00:00Z', type: 'session_meta', payload: { id: 'codex-2', cwd: '/work/api' } },
    { timestamp: '2026-11-01T10:00:01Z', type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
    { timestamp: '2026-11-01T10:00:02Z', type: 'token_usage_record', payload: { response_id: 'resp_2', usage: { input_tokens: 5, output_tokens: 1 } } },
  ), {}, false);
  assert.deepEqual(codex.sessions, { 'codex-2': '/work/api' });
});

test('turns count messages that start work, not tool results, command echoes or agent-to-agent prompts', () => {
  const user = (uuid: string, content: unknown, extra: object = {}) =>
    ({ type: 'user', uuid, sessionId: 'sess-1', timestamp: '2026-11-01T10:00:00Z', message: { role: 'user', content }, ...extra });
  const claude = parseChunk('claude-code', lines(
    user('u1', 'Fix the flaky test'),
    user('u2', [{ type: 'text', text: 'And the lint' }]),
    user('u3', [{ type: 'tool_result', content: 'ok' }]),
    user('u4', '<local-command-stdout>done</local-command-stdout>'),
    user('u5', 'meta', { isMeta: true }),
  ), {}, false);
  assert.deepEqual(claude.turns.map(turn => turn.key), ['claude:u1', 'claude:u2']);
  const codex = parseChunk('codex', lines(
    { timestamp: '2026-11-01T10:00:00Z', type: 'session_meta', payload: { id: 'codex-3' } },
    { timestamp: '2026-11-01T10:00:01Z', type: 'event_msg', payload: { type: 'task_started', turn_attribution: { turn_id: 't1', parent_turn_id: null } } },
    { timestamp: '2026-11-01T10:00:02Z', type: 'event_msg', payload: { type: 'task_started', turn_attribution: { turn_id: 't2', parent_turn_id: 't1' } } },
  ), {}, false);
  assert.deepEqual(codex.turns, [{ key: 'codex:t1', sessionId: 'codex-3', at: Date.parse('2026-11-01T10:00:01Z') }]);
  const pi = parseChunk('pi', lines({ type: 'session', id: 'pi-1' },
    { type: 'message', id: 'e1', timestamp: '2026-11-01T10:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 5 } }), {}, false);
  assert.deepEqual(pi.turns, [{ key: 'pi:e1:5', sessionId: 'pi-1', at: 5 }]);
});

test('Antigravity reads PLANNER_RESPONSE usage and USER_EXPLICIT turns from transcript.jsonl', () => {
  const result = parseChunk('antigravity', lines(
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-01T10:00:00Z', content: 'Check tests' },
    { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-11-01T10:00:02Z',
      model: 'gemini-4-neon-high', input_tokens: 6000, cache_read_tokens: 24000, output_tokens: 450 },
    { step_index: 2, source: 'SYSTEM', type: 'USER_INPUT', created_at: '2026-11-01T10:00:03Z', content: 'system note' },
  ), { sessionId: 'agy-1', cwd: '/work/demo' }, false);
  assert.deepEqual(result.records, [{
    key: 'antigravity:agy-1:1', provider: 'antigravity', sessionId: 'agy-1', at: Date.parse('2026-11-01T10:00:02Z'),
    model: 'gemini-4-neon-high', input: 6000, cacheRead: 24000, cacheWrite5m: 0, cacheWrite1h: 0,
    output: 450, reasoning: 0, speed: 'standard', webSearches: 0,
  }]);
  assert.deepEqual(result.turns, [{ key: 'antigravity:agy-1:0', sessionId: 'agy-1', at: Date.parse('2026-11-01T10:00:00Z') }]);
  assert.deepEqual(result.sessions, { 'agy-1': '/work/demo' });
});

test('omp shares Pi transcript structure and reads reasoningTokens', () => {
  const result = parseChunk('omp', lines(
    { type: 'session', id: 'omp-1', cwd: '/work/demo' },
    { type: 'message', id: 'u1', timestamp: '2026-11-01T10:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 10 } },
    { type: 'message', id: 'a1', timestamp: '2026-11-01T10:00:01Z', message: {
      role: 'assistant', model: 'gpt-5.5', responseId: 'resp_omp', timestamp: 11,
      usage: { input: 200, output: 80, cacheRead: 1000, cacheWrite: 0, reasoningTokens: 50 },
    } },
  ), {}, false);
  assert.deepEqual(result.records, [{
    key: 'omp:resp_omp', provider: 'omp', sessionId: 'omp-1', at: 11, model: 'gpt-5.5',
    input: 200, cacheRead: 1000, cacheWrite5m: 0, cacheWrite1h: 0, output: 80, reasoning: 50, speed: 'standard', webSearches: 0,
  }]);
  assert.deepEqual(result.turns, [{ key: 'omp:u1:10', sessionId: 'omp-1', at: 10 }]);
  assert.deepEqual(result.sessions, { 'omp-1': '/work/demo' });
});

test('Gemini CLI nets cached tokens from input, adds thoughts to output, and skips session_context turns', () => {
  const jsonl = parseChunk('gemini', lines(
    { sessionId: 'gem-1', startTime: '2026-11-01T10:00:00Z' },
    { id: 'u0', type: 'user', timestamp: '2026-11-01T10:00:00Z', content: [{ text: '<session_context>\nbootstrap\n</session_context>' }] },
    { id: 'u1', type: 'user', timestamp: '2026-11-01T10:00:01Z', content: [{ text: 'Explain the diff' }] },
    { id: 'm1', type: 'gemini', timestamp: '2026-11-01T10:00:02Z', model: 'gemini-3.8-flash',
      tokens: { input: 1000, cached: 600, output: 120, thoughts: 30 } },
  ), { cwd: '/work/demo' }, false);
  assert.deepEqual(jsonl.records, [{
    key: 'gemini:gem-1:m1', provider: 'gemini', sessionId: 'gem-1', at: Date.parse('2026-11-01T10:00:02Z'),
    model: 'gemini-3.8-flash', input: 400, cacheRead: 600, cacheWrite5m: 0, cacheWrite1h: 0,
    output: 150, reasoning: 30, speed: 'standard', webSearches: 0,
  }]);
  assert.deepEqual(jsonl.turns, [{ key: 'gemini:gem-1:u1', sessionId: 'gem-1', at: Date.parse('2026-11-01T10:00:01Z') }]);
  const json = parseGeminiJson({
    sessionId: 'gem-2',
    messages: [
      { id: 'u1', type: 'user', timestamp: '2026-11-01T10:00:01Z', content: 'hi' },
      { id: 'm1', type: 'gemini', timestamp: '2026-11-01T10:00:02Z', model: 'gemini-3.8-flash', tokens: { input: 500, cached: 100, output: 50, thoughts: 10 } },
    ],
  }, '/work/demo');
  assert.equal(json.records[0]!.input, 400);
  assert.equal(json.records[0]!.output, 60);
  assert.deepEqual(json.sessions, { 'gem-2': '/work/demo' });
});

test('Grok Build nets cached tokens out of inputTokens per turn and model', () => {
  const result = parseGrokUsage({
    sessionId: 'grok-1',
    updatedAt: '2026-11-01T10:05:00Z',
    turns: [{
      turnNumber: 1,
      endedAt: '2026-11-01T10:05:00Z',
      modelUsage: {
        'grok-4.7-build': { inputTokens: 10_000, cachedReadTokens: 7000, cacheCreationTokens: 500, outputTokens: 900, reasoningTokens: 600 },
      },
    }],
  }, '/work/demo');
  assert.deepEqual(result.records, [{
    key: 'grok:grok-1:t1:grok-4.7-build', provider: 'grok', sessionId: 'grok-1', at: Date.parse('2026-11-01T10:05:00Z'),
    model: 'grok-4.7-build', input: 2500, cacheRead: 7000, cacheWrite5m: 500, cacheWrite1h: 0,
    output: 900, reasoning: 600, speed: 'standard', webSearches: 0,
  }]);
  assert.deepEqual(result.turns, [{ key: 'grok:grok-1:t1', sessionId: 'grok-1', at: Date.parse('2026-11-01T10:05:00Z') }]);
  assert.deepEqual(result.sessions, { 'grok-1': '/work/demo' });
});

test('canonicalProvider maps BB ACP and sandbox provider IDs to cost providers', () => {
  assert.equal(canonicalProvider('acp-antigravity'), 'antigravity');
  assert.equal(canonicalProvider('acp-antigravity-profile-secondary'), 'antigravity');
  assert.equal(canonicalProvider('antigravity-sandbox'), 'antigravity');
  assert.equal(canonicalProvider('acp-opencode'), 'opencode');
  assert.equal(canonicalProvider('acp-grok'), 'grok');
  assert.equal(canonicalProvider('acp-omp'), 'omp');
  assert.equal(canonicalProvider('acp-hermes-agent'), 'hermes');
  assert.equal(canonicalProvider('claude-code'), 'claude-code');
  assert.equal(canonicalProvider('unknown-provider'), undefined);
});
