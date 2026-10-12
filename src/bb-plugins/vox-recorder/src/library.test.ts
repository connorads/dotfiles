import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, formatBytes, hasSegments, isRecordingName, lastLines, matches, parseName, search, titleOf, when } from './library.ts';

test('only the timestamp prefix is parsed; the slug is the title', () => {
  const parsed = parseName('2026-07-28-140312-triver-kickoff');
  assert.equal(parsed?.slug, 'triver-kickoff');
  assert.equal(parsed?.startedAt, new Date(2026, 6, 28, 14, 3, 12).getTime());
  assert.equal(titleOf('2026-07-28-140312-triver-kickoff'), 'triver kickoff');
  assert.equal(titleOf('2026-07-28-140312'), 'untitled');
});

test('names outside the store convention are refused, traversal included', () => {
  assert.equal(isRecordingName('2026-07-28-140312'), true);
  assert.equal(isRecordingName('2026-07-28-140312-a/../../etc'), false);
  assert.equal(isRecordingName('..'), false);
  assert.equal(isRecordingName('notes'), false);
});

test('segments are found in pretty-printed JSON, not fooled by an empty top-level text key', () => {
  assert.equal(hasSegments('{\n  "text": "",\n  "segments": [\n    {\n "text": "hi" } ] }'), true);
  assert.equal(hasSegments('{ "text": "", "segments": [] }'), false);
  assert.equal(hasSegments(null), false);
});

test('kind column: an empty transcript is empty, not solo; system speech means 2-way', () => {
  const base = { live: false, transcribing: false, transcriptSize: 10, sysJson: null };
  assert.equal(classify({ ...base, live: true }), 'recording');
  assert.equal(classify({ ...base, transcribing: true }), 'transcribing');
  assert.equal(classify({ ...base, transcriptSize: null }), 'pending');
  assert.equal(classify({ ...base, transcriptSize: 0, sysJson: '{"segments":[{"text":"x"}]}' }), 'empty');
  assert.equal(classify(base), 'solo');
  assert.equal(classify({ ...base, sysJson: '{"segments":[{"text":"x"}]}' }), '2-way');
});

test('bytes read like du -h', () => {
  assert.deepEqual([512, 2048, 15 * 1024 * 1024, 3.2 * 1024 ** 3].map(formatBytes), ['512B', '2.0K', '15M', '3.2G']);
});

test('search matches every word against title and name', () => {
  const recording = { name: '2026-09-17-100825-triver', title: 'triver', startedAt: 0, kind: 'solo' as const, bytes: 0 };
  assert.equal(matches(recording, 'Triv 09-17'), true);
  assert.equal(matches(recording, 'kickoff'), false);
  assert.equal(matches(recording, ''), true);
});

test('search returns only readable recordings, newest first, capped', () => {
  const rec = (name: string, kind: 'solo' | '2-way' | 'empty' | 'pending') => ({ name, title: titleOf(name), startedAt: 0, kind, bytes: 0 });
  const all = [rec('2026-01-01-000000-standup', 'solo'), rec('2026-01-03-000000-standup', '2-way'), rec('2026-01-02-000000-standup', 'empty'),
    rec('2026-01-04-000000-standup', 'pending'), rec('2026-01-05-000000-retro', 'solo')];
  assert.deepEqual(search(all, 'standup', 5).map(r => r.name), ['2026-01-03-000000-standup', '2026-01-01-000000-standup']);
  assert.deepEqual(search(all, '', 1).map(r => r.name), ['2026-01-05-000000-retro']);
  assert.equal(when('2026-09-17-100825-triver'), '2026-09-17 10:08');
});

test('log tail keeps the last lines', () => {
  assert.equal(lastLines('a\nb\nc\n\n', 2), 'b\nc');
});
