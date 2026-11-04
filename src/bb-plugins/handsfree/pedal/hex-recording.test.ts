import { expect, test } from 'bun:test';
import { startHexRecording, type Run } from './hex-recording.ts';

const fake = (stop: { code: number; stdout?: string; stderr?: string }, start = { code: 0 }) => {
  const calls: string[] = [];
  const run: Run = async args => {
    calls.push(args.join(' '));
    const result = args[1] === 'start' ? start : args[1] === 'stop' ? stop : { code: 0 };
    return { stdout: '', stderr: '', ...result };
  };
  return { run, calls };
};

test('a raw recording returns the printed transcript', async () => {
  const { run, calls } = fake({ code: 0, stdout: 'Next thread.\n' });
  const recording = await startHexRecording(run);
  expect(await recording.finish()).toMatchObject({ transcript: 'Next thread.' });
  expect(calls).toEqual(['dictation start --raw', 'dictation stop --print']);
});

test('no speech gives an empty transcript', async () => {
  const recording = await startHexRecording(fake({ code: 4, stderr: 'hex: no speech was recorded' }).run);
  expect(await recording.finish()).toMatchObject({ transcript: '' });
});

test('a failed stop reports Hex\'s error', async () => {
  const recording = await startHexRecording(fake({ code: 1, stderr: 'hex: Hex is not running' }).run);
  expect(recording.finish()).rejects.toThrow('Hex is not running');
});

test('a failed start never records', async () => {
  expect(startHexRecording(fake({ code: 0 }, { code: 1 }).run)).rejects.toThrow('exited 1');
});

test('cancel discards the recording', async () => {
  const { run, calls } = fake({ code: 0 });
  await (await startHexRecording(run)).cancel();
  expect(calls.at(-1)).toBe('dictation cancel');
});
