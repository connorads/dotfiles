// The host entry end to end, through the SDK's host harness, against real
// files and a stand-in `vox` that keeps the CLI contract (paths on stdout,
// statefile written, transcript left behind).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { experimental_createHostEntryHarness } from '@get-bb/plugin-sdk/testing/host';

const root = await mkdtemp(join(tmpdir(), 'vox-host-'));
const store = join(root, 'store');
const bin = join(root, 'vox');
await mkdir(store);
await writeFile(bin, `#!/bin/sh
state="$VOX_STATEFILE"
case "$1" in
'') d="$VOX_STORE/2026-10-11-090000"; mkdir -p "$d"; sleep 30 >/dev/null 2>&1 &
    echo "$! $(date +%s) $d" > "$state"; echo "vox: recording" >&2; echo "$d" ;;
stop) read pid start d < "$state"; sleep 0.3; kill "$pid"; rm -f "$state"
    printf '[00:00:01] Me: hello\\n' > "$d/transcript.md"; echo "$d" ;;
grab) [ -f "$state" ] || { echo "vox: not recording" >&2; exit 1; }
    printf '# Call in progress: x\\n\\n[00:00:01] Me: hello there\\n[00:00:02] Them: hi\\n' > "${root}/grab.md"
    echo "vox: transcribing the call so far…" >&2; echo "${root}/grab.md" ;;
rename) n="$(dirname "$2")/$(basename "$2")-$3"; mv "$2" "$n"
    # Like vox: renaming the live capture follows it in the statefile.
    if [ -f "$state" ]; then read pid start d < "$state"; [ "$d" = "$2" ] && echo "$pid $start $n" > "$state"; fi
    echo "$n" ;;
transcribe) sleep 0.1; printf '[00:00:01] Me: again\\n' > "$2/transcript.md"; echo "$2" ;;
*) echo "vox: unknown $1" >&2; exit 2 ;;
esac
`);
await chmod(bin, 0o755);
Object.assign(process.env, { VOX_BIN: bin, VOX_STORE: store, VOX_STATEFILE: join(root, 'cache/state'), VOX_SEENFILE: join(root, 'cache/seen') });
await mkdir(join(root, 'cache'));
const { default: entry } = await import('../host.ts');

const watched: string[] = [];
const storeChanged: (() => void)[] = [];
const harness = experimental_createHostEntryHarness(entry, {
  experimental_paths: { dataDir: join(root, 'data'), tempDir: join(root, 'tmp') },
  experimental_watch: (options, listener) => {
    watched.push(options.rootPath);
    storeChanged.push(() => { void listener({} as never); });
    return { dispose: async () => {} };
  },
});

async function until<T>(read: () => T | undefined, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test('a recording runs start, grab, rename, detached stop, ready, seen', async () => {
  assert.equal((await harness.experimental_call('subscribe', {})).state, 'idle');
  assert.deepEqual(watched, [store]);

  const started = await harness.experimental_call('start', {});
  assert.deepEqual(started, { ok: true, path: join(store, '2026-10-11-090000') });
  assert.equal((await harness.experimental_call('status', {})).state, 'recording');
  assert.ok(harness.experimental_getSignals().some(s => s.signal === 'status' && s.payload.state === 'recording'));

  const grab = await harness.experimental_call('grab', { window: null });
  assert.ok(grab.ok);
  assert.equal(grab.label, 'Call so far · 3 words');
  assert.match((await harness.experimental_call('readGrab', { id: grab.id })).text, /Them: hi/);

  const renamed = await harness.experimental_call('rename', { name: '2026-10-11-090000', title: 'kickoff' });
  assert.deepEqual(renamed, { ok: true, path: join(store, '2026-10-11-090000-kickoff') });

  await harness.experimental_call('stop', {});
  // The capture is still flushing, so the pid lives on; a second press must not run a second stop.
  await assert.rejects(harness.experimental_call('stop', {}), /Already stopping/);
  await assert.rejects(harness.experimental_call('cancel', {}), /Already stopping/);
  const finished = await until(() => harness.experimental_getSignals().find(s => s.signal === 'finished'));
  assert.deepEqual(finished.payload, { action: 'stop', name: '2026-10-11-090000-kickoff', ok: true, reason: null });
  await until(() => harness.experimental_getRetainedWorkerLeaseCount() === 0 || undefined);

  assert.equal((await harness.experimental_call('status', {})).state, 'ready');
  assert.equal((await harness.experimental_call('transcript', { name: '2026-10-11-090000-kickoff' })).text, '[00:00:01] Me: hello\n');
  await harness.experimental_call('markSeen', {});
  assert.equal((await harness.experimental_call('status', {})).state, 'idle');
});

test('grab with nothing recording reports vox\'s reason', async () => {
  assert.deepEqual(await harness.experimental_call('grab', { window: '5m' }), { ok: false, reason: 'vox: not recording' });
});

test('names from the app cannot escape the store', async () => {
  await assert.rejects(harness.experimental_call('preview', { name: '../../etc' }), /Not a vox recording/);
  await assert.rejects(harness.experimental_call('readGrab', { id: '../x' }), /Not a grab/);
});

test('retranscribing several recordings runs each in turn and reports each', async () => {
  for (const name of ['2026-01-01-000000', '2026-01-02-000000']) await mkdir(join(store, name));
  const before = harness.experimental_getSignals().length;
  await harness.experimental_call('transcribe', { names: ['2026-01-01-000000', '2026-01-02-000000'] });
  const finished = await until(() => {
    const found = harness.experimental_getSignals().slice(before).filter(s => s.signal === 'finished');
    return found.length === 2 ? found : undefined;
  });
  assert.deepEqual(finished.map(s => s.payload), [
    { action: 'transcribe', name: '2026-01-01-000000', ok: true, reason: null },
    { action: 'transcribe', name: '2026-01-02-000000', ok: true, reason: null },
  ]);
  await until(() => harness.experimental_getRetainedWorkerLeaseCount() === 0 || undefined);
});

test('one window re-reading the status does not hide a change from the others', async () => {
  await harness.experimental_call('markSeen', {});
  // An outside change the watch cannot see: the seen marker moves back, so a transcript is unread again.
  await utimes(join(root, 'cache/seen'), 0, 0);
  const before = harness.experimental_getSignals().length;
  // Another window refocuses and reads the new status for itself.
  assert.equal((await harness.experimental_call('subscribe', {})).state, 'ready');
  storeChanged.forEach(fire => fire());
  await until(() => harness.experimental_getSignals().slice(before).find(s => s.signal === 'status' && s.payload.state === 'ready'));
});

test.after(() => harness.experimental_dispose());
