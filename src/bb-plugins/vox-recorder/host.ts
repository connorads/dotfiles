// Runs on the machine that records: reads vox's files, watches them, and
// drives the `vox` CLI. The host worker gets the user's normalised PATH, which
// vox needs for voxtap, fluidaudiocli, python3 and ffmpeg.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { experimental_defineHostEntry, type ExperimentalHostRpcContext, type ExperimentalHostWatchSubscription } from '@get-bb/plugin-sdk';
import { hostContract, hostSignals } from './contracts.ts';
import { assertIdle, assertReclaimable, isAlive, listRecordings, markSeen, readPreview, readStatus, readTranscript, recordingDir, removeRecordings, voxPaths } from './src/disk.ts';
import { countWords, grabId, grabLabel, isGrabId } from './src/grab.ts';
import { baseName, interpret, reasonOf } from './src/outcome.ts';
import { run, runDetached } from './src/run.ts';
import type { Outcome } from './src/outcome.ts';
import { completedTranscripts } from './src/ingestion-scan.ts';

type Context = ExperimentalHostRpcContext<typeof hostSignals>;

const paths = voxPaths(process.env, homedir());
const quick = { timeoutMs: 20_000 };
/** A long call can take minutes to transcribe on demand. */
const grabTimeoutMs = 10 * 60_000;
/** Pid deaths and seen-marker touches are not store events; re-read at the tmux status-interval. */
const rescanMs = 15_000;

let watching: Promise<void> | null = null;
let subscriptions: ExperimentalHostWatchSubscription[] = [];
let rescan: ReturnType<typeof setInterval> | null = null;
let lastSent = '';
/** The capture a stop is halting: it reads as recording until its flush ends, and a second `vox stop` would transcribe it twice. */
let stopping: string | null = null;

const status = () => readStatus(paths, isAlive);

async function publish(context: Context) {
  const next = await status();
  const key = JSON.stringify(next);
  if (key === lastSent) return;
  lastSent = key;
  await context.experimental_emitSignal('status', next);
}

function subscribe(context: Context) {
  watching ??= (async () => {
    await mkdir(paths.store, { recursive: true });
    const changed = () => {
      void publish(context).catch(() => {});
      void context.experimental_emitSignal('transcriptsChanged', {}).catch(() => {});
    };
    // Capture writes WAV frames continuously, so coalesce generously.
    const options = { debounceMs: 400, maxWaitMs: 2_000 };
    // Only the store: the statefile and seen marker sit in ~/.cache, a busy shared
    // tree. Every start, stop and transcription also writes into the store, and
    // an outside touch of the seen marker shows within one rescan.
    subscriptions = [await context.experimental_watch({ rootPath: paths.store, ...options }, changed)];
    rescan = setInterval(changed, rescanMs);
  })().catch(error => { watching = null; throw error; });
  return watching;
}

/**
 * Run detached jobs one after another; their results arrive as `finished`
 * signals. The lease is taken while the call is still open (the daemon refuses
 * one afterwards) and held until the last job ends, so the worker survives
 * the chain. Each job reports, even one that could not be spawned.
 */
function detachAll(context: Context, action: 'stop' | 'transcribe', jobs: readonly { args: string[]; name: string }[]): Promise<void> {
  const lease = context.experimental_retainWorker();
  const logDir = join(context.experimental_paths.dataDir, 'jobs');
  const one = async ({ args, name }: { args: string[]; name: string }) => {
    let outcome: Outcome;
    try {
      await mkdir(logDir, { recursive: true });
      outcome = interpret(await runDetached(paths.bin, args, { dir: logDir, id: randomUUID() }), `vox ${action} failed`);
    } catch (error) {
      outcome = { ok: false, path: null, reason: error instanceof Error ? error.message : String(error) };
    }
    await context.experimental_emitSignal('finished', {
      action, name: outcome.path ? baseName(outcome.path) : name, ok: outcome.ok, reason: outcome.ok ? null : outcome.reason,
    }).catch(() => {});
    await publish(context).catch(() => {});
  };
  // One at a time, as the tmux picker did: each transcription saturates the Neural Engine.
  return jobs.reduce<Promise<void>>((previous, job) => previous.then(() => one(job)), Promise.resolve())
    .finally(() => lease.dispose());
}

const vox = async (args: string[], fallback: string, timeoutMs = quick.timeoutMs) =>
  interpret(await run(paths.bin, args, { timeoutMs }), fallback);
/** For subcommands with nothing on stdout: exit 0 is the success, stderr the reason. */
async function must(args: string[], fallback: string, timeoutMs = quick.timeoutMs) {
  const result = await run(paths.bin, args, { timeoutMs });
  if (result.code !== 0) throw new Error(reasonOf(result, fallback));
}

export default experimental_defineHostEntry({
  contract: hostContract,
  experimental_signals: hostSignals,
  handlers: {
    completed: () => completedTranscripts(paths, isAlive),
    // Leaves lastSent alone: this answer reaches one window, and the next publish must still reach the rest.
    subscribe: async (_input, context) => { await subscribe(context); return status(); },
    status: () => status(),
    list: () => listRecordings(paths, isAlive),
    preview: ({ name }) => readPreview(paths, name, isAlive),
    transcript: ({ name }) => readTranscript(paths, name),
    transcriptPath: ({ name }) => ({ path: join(recordingDir(paths, name), 'transcript.md') }),
    markSeen: async (_input, context) => { await markSeen(paths); await publish(context); return {}; },
    start: async (_input, context) => {
      const outcome = await vox([], 'vox: the capture did not start');
      await publish(context);
      return outcome;
    },
    stop: async (_input, context) => {
      const current = await status();
      if (!current.recording) throw new Error('Not recording.');
      const { dir } = current.recording;
      if (dir === stopping) throw new Error('Already stopping.');
      stopping = dir;
      void detachAll(context, 'stop', [{ args: ['stop'], name: baseName(dir) }]).finally(() => { if (stopping === dir) stopping = null; });
      return { dir };
    },
    cancel: async (_input, context) => {
      // `vox cancel` deletes whatever capture is live, including one a stop is keeping.
      if (stopping && (await status()).recording?.dir === stopping) throw new Error('Already stopping: the recording is kept.');
      await must(['cancel'], 'vox: could not discard');
      await publish(context);
      return {};
    },
    rename: ({ name, title }) => vox(['rename', recordingDir(paths, name), title], `vox: could not rename ${name}`),
    transcribe: async ({ names }, context) => {
      // Never under a running capture or transcription: both still write into the directory.
      await assertIdle(paths, names, isAlive);
      void detachAll(context, 'transcribe', names.map(name => ({ args: ['transcribe', recordingDir(paths, name)], name })));
      return {};
    },
    remove: async ({ names }, context) => {
      const removed = await removeRecordings(paths, names, isAlive);
      await publish(context);
      return { removed };
    },
    reclaim: async ({ names }) => {
      const dirs = await assertReclaimable(paths, names, isAlive);
      await must(['prune', '--force', ...dirs], 'vox: could not reclaim audio', 120_000);
      return {};
    },
    reveal: async ({ name }) => {
      const result = await run('open', ['-R', recordingDir(paths, name)], quick);
      if (result.code !== 0) throw new Error(result.stderr.trim() || `Could not reveal ${name}.`);
      return {};
    },
    grab: async ({ window }, context) => {
      const outcome = await vox(window ? ['grab', window] : ['grab'], 'vox: grab failed', grabTimeoutMs);
      if (!outcome.ok) return { ok: false as const, reason: outcome.reason };
      // vox grab writes into a fresh temp dir; keep a copy the mention can read at send time.
      const text = await readFile(outcome.path, 'utf8');
      const id = grabId(new Date(), Math.random);
      const dir = join(context.experimental_paths.dataDir, 'grabs');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${id}.md`), text);
      const words = countWords(text);
      return { ok: true as const, id, words, label: grabLabel(window, words) };
    },
    readGrab: async ({ id }, context) => {
      if (!isGrabId(id)) throw new Error(`Not a grab: ${id}`);
      const path = join(context.experimental_paths.dataDir, 'grabs', `${id}.md`);
      return { path, text: await readFile(path, 'utf8') };
    },
  },
  dispose: async () => {
    if (rescan) clearInterval(rescan);
    await Promise.all(subscriptions.map(subscription => subscription.dispose()));
    subscriptions = [];
    watching = null;
  },
});
