import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords, grabId, grabLabel, isGrabId, isWindow, mentionContext, parseMentionId } from './grab.ts';
import { isRecordingName } from './library.ts';

test('windows follow vox grab: a count and an optional s/m/h unit', () => {
  assert.deepEqual(['5m', '90s', '1h', '10', '5d', 'm5', ''].map(isWindow), [true, true, true, true, false, false, false]);
});

test('word count skips the header and the timestamp-speaker prefix', () => {
  const md = '# Call in progress: kickoff, 00:00:00-00:05:00 so far. Header words here.\n\n[00:00:01] Me: hello there\n[00:00:04] Them: hi again friend\n';
  assert.equal(countWords(md), 5);
});

test('labels name the span and pluralise', () => {
  assert.equal(grabLabel(null, 1), 'Call so far · 1 word');
  assert.equal(grabLabel('5m', 812), 'Last 5m of call · 812 words');
});

test('grab ids are generated in the shape the reader accepts', () => {
  const id = grabId(new Date(2026, 9, 11, 9, 5, 7), () => 0.5);
  assert.equal(id, 'grab-20261011-090507-iiiiii');
  assert.equal(isGrabId(id), true);
  assert.equal(isGrabId('grab-../../etc/passwd'), false);
});

test('mention ids route to a recording or a grab and refuse anything else', () => {
  assert.deepEqual(parseMentionId('rec:2026-09-17-100825-alpha', isRecordingName), { kind: 'recording', name: '2026-09-17-100825-alpha' });
  assert.deepEqual(parseMentionId('grab:grab-20261011-090507-abc123', isRecordingName), { kind: 'grab', id: 'grab-20261011-090507-abc123' });
  assert.equal(parseMentionId('rec:../secrets', isRecordingName), null);
  assert.equal(parseMentionId('nonsense', isRecordingName), null);
});

test('mention context names its source and path before the text', () => {
  assert.equal(mentionContext('Vox recording "alpha"', '/r/t.md', '\nhello\n\n'), 'Vox recording "alpha". Saved at /r/t.md.\n\nhello\n');
});
