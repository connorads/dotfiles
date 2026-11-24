import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Measurement } from '../usage-source.ts';

const run = promisify(execFile);
const fields = { plan: null, accountEmail: null, planLabel: null };
const bucket = z.object({ id: z.string().min(1), name: z.string().min(1), window: z.string(),
  disabled: z.boolean().optional(),
  remaining_fraction: z.number().min(0).max(1), reset_time: z.string().datetime({ offset: true }).optional() });
const reply = z.object({ status: z.literal('SUCCESS'), num_turns: z.literal(0),
  usage: z.object({ total_tokens: z.literal(0) }),
  command: z.object({ name: z.literal('usage'), data: z.object({
    groups: z.array(z.object({ name: z.string().min(1), buckets: z.array(bucket).min(1) })).min(1),
  }) }),
});

export function parseAntigravityUsage(value: unknown, observedAt = Date.now()): Measurement {
  const data = reply.parse(value);
  const ids = new Set<string>();
  const windows = data.command.data.groups.flatMap(group => group.buckets.flatMap(bucket => {
    if (ids.has(bucket.id)) throw new Error('Duplicate Antigravity quota bucket.');
    ids.add(bucket.id);
    if (bucket.disabled) return [];
    const kind = bucket.window === 'weekly' ? 'weekly' : bucket.window === '5h' ? 'five-hour' : 'custom';
    const period = kind === 'weekly' ? 'Weekly' : kind === 'five-hour' ? '5-hour' : bucket.name;
    return [{ id: bucket.id, label: `${group.name} · ${period}`, kind,
      usedPercent: Math.round((1 - bucket.remaining_fraction) * 1e6) / 1e4,
      resetsAt: bucket.reset_time ?? null, model: null, cost: null } satisfies Extract<Measurement['usage'], { status: 'ok' }>['windows'][number]];
  }));
  if (windows.length === 0) throw new Error('Antigravity quota returned no active buckets.');
  return { accountKey: null, observedAt, usage: { status: 'ok', ...fields, windows } };
}

export async function collectAntigravityUsage(options: {
  command?: readonly string[]; timeoutMs?: number; signal?: AbortSignal;
} = {}): Promise<Measurement> {
  const unavailable = (message: string): Measurement => ({ accountKey: null, observedAt: null,
    usage: { status: 'error', ...fields, message } });
  if (options.signal?.aborted) return unavailable('Antigravity quota collection cancelled.');
  const [executable, ...args] = options.command ?? ['agy'];
  if (!executable) return unavailable('Antigravity CLI unavailable.');
  try {
    const cwd = await mkdtemp(join(tmpdir(), 'bb-antigravity-quota-'));
    const { stdout } = await run(executable,
      [...args, '--print', '/usage', '--output-format', 'json', '--print-timeout', '20s'],
      { cwd, signal: options.signal, timeout: options.timeoutMs ?? 25_000, maxBuffer: 1_048_576, killSignal: 'SIGKILL' });
    return parseAntigravityUsage(JSON.parse(stdout));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { accountKey: null, observedAt: null, usage: { status: 'not_installed', ...fields } };
    if (error instanceof Error && ['stdout', 'stderr'].some(stream => {
      const output: unknown = Reflect.get(error, stream);
      return typeof output === 'string' && /\b(?:not authenticated|authentication required)\b/iu.test(output);
    }))
      return { accountKey: null, observedAt: null, usage: { status: 'unauthenticated', ...fields } };
    return unavailable(options.signal?.aborted ? 'Antigravity quota collection cancelled.'
      : 'Antigravity quota unavailable. Refresh to try again.');
  }
}
