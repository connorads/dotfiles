import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChunk } from './records.ts';

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
