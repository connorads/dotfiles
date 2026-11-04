import type { Recording } from '../pedal-session.ts';

export type Run = (args: readonly string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const HEX = '/Applications/Hex.app/Contents/MacOS/hex';
// `hex dictation stop --print` exits 4 when it heard no speech.
const NO_SPEECH = 4;

const failure = (args: readonly string[], result: { code: number; stderr: string }) =>
  new Error(result.stderr.trim() || `hex ${args.join(' ')} exited ${result.code}`);

// --raw skips Hex's Output steps, so a BB transform cannot act on a command first.
export async function startHexRecording(run: Run, now: () => number = Date.now): Promise<Recording> {
  const start = ['dictation', 'start', '--raw'];
  const started = await run(start);
  if (started.code !== 0) throw failure(start, started);
  const startedAt = now();
  return {
    async finish() {
      const stop = ['dictation', 'stop', '--print'];
      const result = await run(stop);
      const durationMs = now() - startedAt;
      if (result.code === NO_SPEECH) return { transcript: '', durationMs };
      if (result.code !== 0) throw failure(stop, result);
      return { transcript: result.stdout.trim(), durationMs };
    },
    async cancel() {
      await run(['dictation', 'cancel']);
    },
  };
}

export const runHex: Run = async args => {
  const proc = Bun.spawn([HEX, ...args], { stdout: 'pipe', stderr: 'pipe', timeout: 75000 });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  return { code, stdout, stderr };
};
