// Runs the `vox` CLI from the host worker. Every child gets its own process
// group (`detached`): the worker is idle-stopped and restarted by the daemon,
// and a capture or a minutes-long transcription must not die with it.
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Run } from './outcome.ts';

export interface RunOptions { timeoutMs: number }

/** Run to completion and collect both streams. A timeout ends the whole group. */
export function run(bin: string, args: readonly string[], options: RunOptions): Promise<Run> {
  return new Promise(resolve => {
    const child = spawn(bin, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const stop = () => { try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* already gone */ } };
    const timer = setTimeout(stop, options.timeoutMs);
    child.on('error', error => { stderr += `${error.message}\n`; });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Where a detached job writes its streams: `<dir>/<id>.out` and `<dir>/<id>.err`. */
export interface JobLog { dir: string; id: string }

/**
 * Start a job that outlives the call: streams go to files rather than pipes,
 * so the child never writes into a pipe whose reader has gone. The promise
 * settles only if this worker is still alive when the job ends.
 */
export function runDetached(bin: string, args: readonly string[], log: JobLog): Promise<Run> {
  return new Promise(resolve => {
    const outPath = join(log.dir, `${log.id}.out`);
    const errPath = join(log.dir, `${log.id}.err`);
    const out = openSync(outPath, 'w');
    const err = openSync(errPath, 'w');
    const child = spawn(bin, args, { detached: true, stdio: ['ignore', out, err] });
    closeSync(out);
    closeSync(err);
    child.unref();
    let spawnError = '';
    child.on('error', error => { spawnError = `${error.message}\n`; });
    child.on('close', async code => {
      const [stdout, stderr] = await Promise.all([outPath, errPath].map(path => readFile(path, 'utf8').catch(() => '')));
      await Promise.all([outPath, errPath].map(path => rm(path, { force: true })));
      resolve({ code, stdout: stdout ?? '', stderr: `${stderr ?? ''}${spawnError}` });
    });
  });
}
