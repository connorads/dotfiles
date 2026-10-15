import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript } from './transcript.ts';

// Shape copied from a real Claude Code 2.1.293 session transcript.
const assistant = (id: string, timestamp: string, usage: object, extra: object = {}) => JSON.stringify({
  type: 'assistant', isSidechain: false, timestamp, ...extra,
  message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 2, output_tokens: 427, service_tier: 'standard', ...usage } },
});
const warm = { cache_read_input_tokens: 180933, cache_creation_input_tokens: 1658,
  cache_creation: { ephemeral_1h_input_tokens: 1658, ephemeral_5m_input_tokens: 0 } };

test('an assistant entry becomes one request with its 1h cache lifetime', () => {
  const { items } = parseTranscript(Buffer.from(assistant('msg_1', '2026-10-10T23:13:19.619Z', warm) + '\n'));
  assert.deepEqual(items, [{ kind: 'usage', id: 'msg_1', sample: {
    at: Date.parse('2026-10-10T23:13:19.619Z'), prompt: 182593, read: 180933, write: 1658, ttlMs: 3_600_000, model: 'claude-opus-5-5' } }]);
});

test('a request writing both tiers reports the shorter lifetime', () => {
  const usage = { ...warm, cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 658 } };
  const { items } = parseTranscript(Buffer.from(assistant('msg_1', '2026-10-10T23:13:19.619Z', usage) + '\n'));
  assert.equal(items[0]?.kind === 'usage' && items[0].sample.ttlMs, 300_000);
});

test('a partly written last line is left for the next read', () => {
  const complete = assistant('msg_1', '2026-10-10T23:13:19.619Z', warm) + '\n';
  const { consumed, items } = parseTranscript(Buffer.from(complete + '{"type":"assist'));
  assert.equal(consumed, Buffer.byteLength(complete));
  assert.equal(items.length, 1);
});

test('subagent turns, other entry types and bad lines are skipped; compaction resets', () => {
  const lines = [
    assistant('msg_side', '2026-10-10T23:13:19.619Z', warm, { isSidechain: true }),
    JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: 'hi' } }),
    'not json',
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', isSidechain: false, content: 'Conversation compacted' }),
  ];
  assert.deepEqual(parseTranscript(Buffer.from(lines.join('\n') + '\n')).items, [{ kind: 'reset' }]);
});

test('attachments that break the cache prefix become signals', () => {
  const attachment = (value: object) => JSON.stringify({ type: 'attachment', isSidechain: false, attachment: value });
  const lines = [
    attachment({ type: 'deferred_tools_delta', addedNames: ['mcp__chrome__click'], removedNames: [] }),
    attachment({ type: 'mcp_instructions_delta', addedNames: ['chrome'], removedNames: [] }),
    attachment({ type: 'skill_listing', names: ['testing'], isInitial: false }),
    attachment({ type: 'credential_org', organizationUuid: 'org' }),
    attachment({ type: 'thinking_drop', newlyDropped: { reason: 'prefix_mismatch', blockCount: 3 } }),
    attachment({ type: 'thinking_drop', newlyDropped: { reason: 'budget', blockCount: 3 } }),
    attachment({ type: 'total_tokens_reminder', text: '15000000' }),
    JSON.stringify({ type: 'attachment', isSidechain: true, attachment: { type: 'credential_org' } }),
  ];
  assert.deepEqual(parseTranscript(Buffer.from(lines.join('\n') + '\n')).items.map(item => item.kind === 'signal' && item.signal),
    ['tools', 'tools', 'tools', 'account', 'prefix']);
});
