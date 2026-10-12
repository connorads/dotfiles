import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveStatus, humanAge, parseJobMarker, parseStatefile, pill, type Facts } from './state.ts';

const none: Facts = { capture: null, jobs: [], transcripts: [], seenMtimeMs: 0 };

test('statefile keeps spaces in the directory and reads a pid list leader first', () => {
  assert.deepEqual(parseStatefile('123,456 1700000000 /rec/a b c\n'), { pids: ['123', '456'], startedAt: 1700000000, dir: '/rec/a b c' });
  assert.deepEqual(parseStatefile('123 notanumber /rec/x'), { pids: ['123'], startedAt: null, dir: '/rec/x' });
  assert.equal(parseStatefile(''), null);
});

test('job marker reads pid and start epoch', () => {
  assert.deepEqual(parseJobMarker('99 1700000100\n'), { pid: '99', startedAt: 1700000100 });
  assert.equal(parseJobMarker('\n'), null);
});

test('states rank worst first: recording beats transcribing beats empty beats ready', () => {
  const all: Facts = {
    capture: { pids: ['1'], startedAt: 100, dir: '/r/live', alive: true },
    jobs: [{ dir: '/r/a', startedAt: 50, alive: true }],
    transcripts: [{ dir: '/r/b', size: 0, mtimeMs: 10 }, { dir: '/r/c', size: 5, mtimeMs: 10 }],
    seenMtimeMs: 5,
  };
  assert.equal(deriveStatus(all).state, 'recording');
  assert.equal(deriveStatus({ ...all, capture: { ...all.capture!, alive: false } }).state, 'transcribing');
  assert.equal(deriveStatus({ ...all, capture: null, jobs: [] }).state, 'empty');
  assert.equal(deriveStatus({ ...all, capture: null, jobs: [], transcripts: all.transcripts.slice(1) }).state, 'ready');
  assert.equal(deriveStatus(none).state, 'idle');
});

test('a dead capture or dead transcriber reads as finished without a reaper', () => {
  const status = deriveStatus({ ...none, capture: { pids: ['1'], startedAt: 1, dir: '/r/x', alive: false }, jobs: [{ dir: '/r/x', startedAt: 1, alive: false }] });
  assert.equal(status.state, 'idle');
  assert.equal(status.recording, null);
});

test('only transcripts strictly newer than the seen marker count; no marker counts all', () => {
  const transcripts = [{ dir: '/r/a', size: 9, mtimeMs: 100 }, { dir: '/r/b', size: 9, mtimeMs: 200 }];
  assert.equal(deriveStatus({ ...none, transcripts, seenMtimeMs: 100 }).unread, 1);
  assert.equal(deriveStatus({ ...none, transcripts, seenMtimeMs: null }).unread, 2);
});

test('transcribing tracks the oldest live job and the newest directory', () => {
  const status = deriveStatus({ ...none, jobs: [
    { dir: '/r/2026-01-01-000000', startedAt: 300, alive: true },
    { dir: '/r/2026-01-02-000000', startedAt: 200, alive: true },
    { dir: '/r/2026-01-03-000000', startedAt: 100, alive: false },
  ] });
  assert.deepEqual(status.jobs, { count: 2, oldestStartedAt: 200, newestDir: '/r/2026-01-02-000000' });
});

test('human age matches the tmux token formatter', () => {
  assert.deepEqual([0, 59, 60, 3599, 3600, 86_400, -5].map(humanAge), ['0s', '59s', '1m', '59m', '1h', '1d', '0s']);
});

test('pill shows elapsed while recording, a count when several jobs run, and hides when idle', () => {
  const base = deriveStatus(none);
  assert.equal(pill(base, 0), null);
  assert.deepEqual(pill({ ...base, state: 'recording', recording: { dir: '/r', startedAt: 1000 } }, 1000 + 720),
    { glyph: '~', text: '12m', tone: 'muted', label: 'Recording for 12m' });
  assert.equal(pill({ ...base, state: 'transcribing', jobs: { count: 1, oldestStartedAt: 960, newestDir: '/r' } }, 1000)?.text, '40s');
  assert.equal(pill({ ...base, state: 'transcribing', jobs: { count: 3, oldestStartedAt: 0, newestDir: '/r' } }, 1000)?.text, '3');
  assert.deepEqual(pill({ ...base, state: 'empty', empty: 1 }, 0), { glyph: '!', text: '1', tone: 'empty', label: '1 recording transcribed to nothing' });
  assert.equal(pill({ ...base, state: 'ready', unread: 2 }, 0)?.label, '2 new transcripts');
});
