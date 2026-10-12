import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertReclaimable, isAlive, listRecordings, markSeen, readPreview, readStatus, readTranscript, removeRecordings, voxPaths, type IsAlive } from './disk.ts';

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'vox-recorder-'));
  const paths = voxPaths({}, home);
  await mkdir(paths.store, { recursive: true });
  await mkdir(join(home, '.cache'), { recursive: true });
  const rec = async (name: string, files: Record<string, string>) => {
    const dir = join(paths.store, name);
    await mkdir(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) await writeFile(join(dir, file), content);
    return dir;
  };
  return { home, paths, rec };
}
const livePids = (...pids: string[]): IsAlive => pid => pids.includes(pid);

test('kill -0 liveness: this process is alive, an exited child is not', () => {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
  assert.equal(isAlive(String(process.pid)), true);
  assert.equal(isAlive(child.stdout.toString()), false);
  assert.equal(isAlive('not-a-pid'), false);
});

test('env overrides match vox-lib.sh', () => {
  assert.deepEqual(voxPaths({ VOX_STORE: '/s' }, '/h'), { bin: '/h/.local/bin/vox', store: '/s', statefile: '/h/.cache/tmux-vox.state', seenfile: '/h/.cache/tmux-vox.seen' });
});

test('status reads the real statefile, job markers and seen marker', async () => {
  const { paths, rec } = await fixture();
  const live = await rec('2026-10-11-090000-standup', { 'mic.wav': 'x' });
  await writeFile(paths.statefile, `4242 1700000000 ${live}\n`);
  await rec('2026-10-10-090000', { 'transcribing.pid': '777 1700000100\n' });
  await rec('2026-10-09-090000', { 'transcript.md': '' });
  assert.equal((await readStatus(paths, livePids('4242', '777'))).state, 'recording');
  assert.equal((await readStatus(paths, livePids('777'))).state, 'transcribing');
  assert.equal((await readStatus(paths, livePids())).state, 'empty');
  await markSeen(paths);
  assert.equal((await readStatus(paths, livePids())).state, 'idle');
});

test('a transcript finishing after the last look reads ready', async () => {
  const { paths, rec } = await fixture();
  await markSeen(paths, new Date(1_000_000));
  const dir = await rec('2026-10-11-090000-call', { 'transcript.md': '[00:00:01] Me: hi\n' });
  await utimes(join(dir, 'transcript.md'), new Date(2_000_000), new Date(2_000_000));
  const status = await readStatus(paths, livePids());
  assert.deepEqual([status.state, status.unread], ['ready', 1]);
});

test('library lists newest first with derived kinds and skips foreign directories', async () => {
  const { paths, rec } = await fixture();
  await rec('2026-10-01-100000-meeting', { 'transcript.md': 'hello', 'sys.json': '{"segments":[{"text":"hi"}]}' });
  await rec('2026-10-02-100000-memo', { 'transcript.md': 'hello', 'sys.json': '{"text":"","segments":[]}' });
  await rec('2026-10-03-100000', { 'transcript.md': '' });
  await rec('stray-folder', {});
  const list = await listRecordings(paths, livePids());
  assert.deepEqual(list.map(r => [r.name, r.title, r.kind]), [
    ['2026-10-03-100000', 'untitled', 'empty'],
    ['2026-10-02-100000-memo', 'memo', 'solo'],
    ['2026-10-01-100000-meeting', 'meeting', '2-way'],
  ]);
  assert.equal(list[2]!.bytes, 'hello'.length + '{"segments":[{"text":"hi"}]}'.length);
});

test('preview is honest about empty, transcribing and missing transcripts', async () => {
  const { paths, rec } = await fixture();
  await rec('2026-10-01-100000', { 'transcript.md': 'words', 'vox.log': 'x' });
  await rec('2026-10-02-100000', { 'transcript.md': '', 'vox.log': 'a\nb\nfluidaudiocli: nothing\n' });
  await rec('2026-10-03-100000', { 'transcribing.pid': '55 1', 'vox.log': 'transcribing mic…' });
  await rec('2026-10-04-100000', { 'mic.wav': '' });
  assert.deepEqual(await readPreview(paths, '2026-10-01-100000', livePids()), { kind: 'transcript', text: 'words', truncated: false });
  assert.deepEqual(await readPreview(paths, '2026-10-02-100000', livePids()), { kind: 'empty', log: 'a\nb\nfluidaudiocli: nothing' });
  assert.deepEqual(await readPreview(paths, '2026-10-03-100000', livePids('55')), { kind: 'transcribing', log: 'transcribing mic…' });
  assert.deepEqual(await readPreview(paths, '2026-10-04-100000', livePids()), { kind: 'none', files: ['mic.wav'] });
  await assert.rejects(readPreview(paths, '../../etc', livePids()), /Not a vox recording/);
});

test('reading a transcript refuses empty and missing ones with a reason', async () => {
  const { paths, rec } = await fixture();
  await rec('2026-10-01-100000-a', { 'transcript.md': 'hi' });
  await rec('2026-10-02-100000-b', { 'transcript.md': ' \n' });
  assert.equal((await readTranscript(paths, '2026-10-01-100000-a')).text, 'hi');
  await assert.rejects(readTranscript(paths, '2026-10-02-100000-b'), /b transcribed to nothing/);
  await assert.rejects(readTranscript(paths, '2026-10-03-100000-c'), /c has no transcript yet/);
});

test('delete removes finished recordings but refuses the live capture and a running job', async () => {
  const { paths, rec } = await fixture();
  const live = await rec('2026-10-03-100000-live', { 'mic.wav': '' });
  await writeFile(paths.statefile, `9 1 ${live}\n`);
  await rec('2026-10-02-100000-busy', { 'transcribing.pid': '8 1' });
  await rec('2026-10-01-100000-done', { 'transcript.md': 'x' });
  await assert.rejects(removeRecordings(paths, ['2026-10-03-100000-live'], livePids('9', '8')), /live recording/);
  await assert.rejects(removeRecordings(paths, ['2026-10-02-100000-busy'], livePids('9', '8')), /busy is being transcribed/);
  await removeRecordings(paths, ['2026-10-01-100000-done'], livePids('9', '8'));
  assert.deepEqual((await readdir(paths.store)).sort(), ['2026-10-02-100000-busy', '2026-10-03-100000-live']);
});

test('reclaim refuses a live, busy, untranscribed or empty recording, whose audio is all there is', async () => {
  const { paths, rec } = await fixture();
  const live = await rec('2026-10-05-100000-live', { 'mic.wav': '' });
  await writeFile(paths.statefile, `9 1 ${live}\n`);
  await rec('2026-10-04-100000-busy', { 'transcribing.pid': '8 1', 'mic.wav': '' });
  await rec('2026-10-03-100000-pending', { 'mic.wav': '' });
  await rec('2026-10-02-100000-silent', { 'mic.wav': '', 'transcript.md': '' });
  const done = await rec('2026-10-01-100000-done', { 'mic.opus': '', 'transcript.md': 'x' });
  const alive = livePids('9', '8');
  await assert.rejects(assertReclaimable(paths, ['2026-10-05-100000-live'], alive), /live recording/);
  await assert.rejects(assertReclaimable(paths, ['2026-10-04-100000-busy'], alive), /busy is being transcribed/);
  await assert.rejects(assertReclaimable(paths, ['2026-10-03-100000-pending'], alive), /pending has no transcript/);
  await assert.rejects(assertReclaimable(paths, ['2026-10-02-100000-silent'], alive), /silent has no transcript/);
  assert.deepEqual(await assertReclaimable(paths, ['2026-10-01-100000-done'], alive), [done]);
});
