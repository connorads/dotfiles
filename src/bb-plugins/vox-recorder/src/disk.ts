// The filesystem edge of the host worker: reads the vox statefile, the store
// and the seen marker into plain facts. Liveness is injected so tests can use
// real files with a known set of live pids.
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classify, isRecordingName, lastLines, newestFirst, parseName, titleOf, type Preview, type Recording } from './library.ts';
import { deriveStatus, JOB_MARKER, parseJobMarker, parseStatefile, type Facts, type VoxStatus } from './state.ts';

export interface VoxPaths { bin: string; store: string; statefile: string; seenfile: string }

/** The same env overrides vox-lib.sh honours, so tests and real use agree. */
export function voxPaths(env: Record<string, string | undefined>, home: string): VoxPaths {
  return {
    bin: env.VOX_BIN || join(home, '.local/bin/vox'),
    store: env.VOX_STORE || join(home, 'Recordings/vox'),
    statefile: env.VOX_STATEFILE || join(home, '.cache/tmux-vox.state'),
    seenfile: env.VOX_SEENFILE || join(home, '.cache/tmux-vox.seen'),
  };
}

export type IsAlive = (pid: string) => boolean;

/** `kill -0`: only a signal we may send counts as alive, as in the shell. */
export const isAlive: IsAlive = pid => {
  if (!/^\d+$/.test(pid)) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
};

const readText = (path: string) => readFile(path, 'utf8').catch(() => null);
const statOrNull = (path: string) => stat(path).catch(() => null);

async function recordingDirs(store: string): Promise<string[]> {
  const entries = await readdir(store, { withFileTypes: true }).catch(() => []);
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse();
}

export async function readFacts(paths: VoxPaths, alive: IsAlive): Promise<Facts> {
  const statefile = await readText(paths.statefile);
  const capture = statefile === null ? null : parseStatefile(statefile);
  const jobs: Facts['jobs'][number][] = [];
  const transcripts: Facts['transcripts'][number][] = [];
  for (const name of await recordingDirs(paths.store)) {
    const dir = join(paths.store, name);
    const marker = await readText(join(dir, JOB_MARKER));
    const job = marker === null ? null : parseJobMarker(marker);
    if (job) jobs.push({ dir, startedAt: job.startedAt, alive: alive(job.pid) });
    const transcript = await statOrNull(join(dir, 'transcript.md'));
    if (transcript?.isFile()) transcripts.push({ dir, size: transcript.size, mtimeMs: transcript.mtimeMs });
  }
  const seen = await statOrNull(paths.seenfile);
  return {
    capture: capture && { ...capture, alive: capture.pids[0] !== undefined && alive(capture.pids[0]) },
    jobs, transcripts, seenMtimeMs: seen ? seen.mtimeMs : null,
  };
}

export const readStatus = async (paths: VoxPaths, alive: IsAlive): Promise<VoxStatus> => deriveStatus(await readFacts(paths, alive));

async function jobLive(dir: string, alive: IsAlive) {
  const marker = await readText(join(dir, JOB_MARKER));
  const job = marker === null ? null : parseJobMarker(marker);
  return job !== null && alive(job.pid);
}

async function dirBytes(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(entries.filter(e => e.isFile()).map(e => statOrNull(join(dir, e.name)).then(s => s?.size ?? 0)));
  return sizes.reduce((sum, size) => sum + size, 0);
}

export async function listRecordings(paths: VoxPaths, alive: IsAlive): Promise<Recording[]> {
  const statefile = await readText(paths.statefile);
  const capture = statefile === null ? null : parseStatefile(statefile);
  const liveDir = capture?.pids[0] && alive(capture.pids[0]) ? capture.dir : null;
  const names = (await recordingDirs(paths.store)).filter(isRecordingName);
  const recordings = await Promise.all(names.map(async name => {
    const dir = join(paths.store, name);
    const transcript = await statOrNull(join(dir, 'transcript.md'));
    return {
      name, title: titleOf(name), startedAt: parseName(name)!.startedAt, bytes: await dirBytes(dir),
      kind: classify({
        live: dir === liveDir, transcribing: await jobLive(dir, alive),
        transcriptSize: transcript?.isFile() ? transcript.size : null, sysJson: await readText(join(dir, 'sys.json')),
      }),
    };
  }));
  return recordings.sort(newestFirst);
}

/** Resolve a name from the app into a directory under the store, or throw. */
export function recordingDir(paths: VoxPaths, name: string): string {
  if (!isRecordingName(name)) throw new Error(`Not a vox recording: ${name}`);
  return join(paths.store, name);
}

const previewLimit = 256 * 1024;

export async function readPreview(paths: VoxPaths, name: string, alive: IsAlive): Promise<Preview> {
  const dir = recordingDir(paths, name);
  const transcript = await readText(join(dir, 'transcript.md'));
  const log = lastLines(await readText(join(dir, 'vox.log')) ?? '', 10);
  if (transcript) return { kind: 'transcript', text: transcript.slice(0, previewLimit), truncated: transcript.length > previewLimit };
  if (transcript !== null) return { kind: 'empty', log };
  if (await jobLive(dir, alive)) return { kind: 'transcribing', log };
  return { kind: 'none', files: (await readdir(dir).catch(() => [])).sort((a, b) => a.localeCompare(b)) };
}

export async function readTranscript(paths: VoxPaths, name: string): Promise<{ path: string; text: string }> {
  const path = join(recordingDir(paths, name), 'transcript.md');
  const text = await readText(path);
  if (!text?.trim()) throw new Error(text === null ? `${titleOf(name)} has no transcript yet.` : `${titleOf(name)} transcribed to nothing.`);
  return { path, text };
}

/**
 * Refuse recordings that a process still writes into: the live capture, or
 * one mid-transcription. Returns their directories.
 */
export async function assertIdle(paths: VoxPaths, names: readonly string[], alive: IsAlive): Promise<string[]> {
  const status = await readStatus(paths, alive);
  const dirs = names.map(name => recordingDir(paths, name));
  for (const dir of dirs) {
    if (dir === status.recording?.dir) throw new Error('That is the live recording: stop or discard it first.');
    if (await jobLive(dir, alive)) throw new Error(`${titleOf(dir.split('/').at(-1)!)} is being transcribed.`);
  }
  return dirs;
}

/**
 * Reclaiming deletes audio for good, so only from idle recordings whose
 * transcript holds words: for a pending or empty one the audio is all there is.
 */
export async function assertReclaimable(paths: VoxPaths, names: readonly string[], alive: IsAlive): Promise<string[]> {
  const dirs = await assertIdle(paths, names, alive);
  for (const dir of dirs) {
    const transcript = await statOrNull(join(dir, 'transcript.md'));
    if (!transcript?.isFile() || transcript.size === 0) throw new Error(`${titleOf(dir.split('/').at(-1)!)} has no transcript to keep, so its audio stays.`);
  }
  return dirs;
}

/** Delete whole recordings, never one a process still writes into. */
export async function removeRecordings(paths: VoxPaths, names: readonly string[], alive: IsAlive): Promise<string[]> {
  const dirs = await assertIdle(paths, names, alive);
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  return names.slice();
}

/** Touching the marker is the only write: its mtime is "last looked". */
export async function markSeen(paths: VoxPaths, now = new Date()): Promise<void> {
  await mkdir(join(paths.seenfile, '..'), { recursive: true });
  await writeFile(paths.seenfile, '');
  await utimes(paths.seenfile, now, now);
}
