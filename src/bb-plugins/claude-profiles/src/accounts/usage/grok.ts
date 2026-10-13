import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { Measurement } from '../usage-source.ts';

const replySchema = z.object({ id: z.number().optional(), result: z.unknown().optional(), error: z.unknown().optional() });
const billingSchema = z.object({
  subscription_tier: z.string().optional(),
  config: z.object({
    creditUsagePercent: z.number().nonnegative(),
    currentPeriod: z.object({ type: z.string().optional(), end: z.string().datetime({ offset: true }).optional() }).optional(),
  }),
});

export async function collectGrokUsage(options: {
  command?: readonly string[]; timeoutMs?: number; signal?: AbortSignal;
} = {}): Promise<Measurement> {
  const fields = { plan: null, accountEmail: null, planLabel: null };
  const unavailable = (message: string): Measurement => ({ accountKey: null, observedAt: null,
    usage: { status: 'error', ...fields, message } });
  if (options.signal?.aborted) return unavailable('Grok usage collection cancelled.');
  const command = options.command ?? ['grok'];
  const executable = command[0];
  if (!executable) return unavailable('Grok CLI unavailable.');
  let directory: string;
  try { directory = await mkdtemp(join(tmpdir(), 'bb-grok-usage-')); }
  catch { return unavailable('Cannot create Grok usage working directory.'); }
  const child = spawn(executable, [...command.slice(1), 'agent', '--no-leader', 'stdio'], {
    cwd: directory, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  let pending: { id: number; resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined;
  let failure: Error | undefined;
  function fail(message: string) {
    failure = new Error(message);
    pending?.reject(failure);
    pending = undefined;
  }
  child.on('error', () => fail('Grok CLI unavailable.'));
  child.on('close', () => fail('Grok CLI exited before returning usage.'));
  child.stdin.on('error', () => fail('Grok CLI communication failed.'));
  let responseBytes = 0;
  child.stdout.on('data', (chunk: Buffer) => {
    responseBytes += chunk.length;
    if (responseBytes > 1_048_576) fail('Grok usage response exceeded the size limit.');
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    if (failure) return;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { fail('Invalid Grok usage response.'); return; }
    const parsed = replySchema.safeParse(raw);
    if (!parsed.success) { fail('Invalid Grok usage response.'); return; }
    if (!pending || parsed.data.id !== pending.id) return;
    if (parsed.data.error !== undefined) { fail('Grok usage unavailable. Check Grok login.'); return; }
    pending.resolve(parsed.data.result);
    pending = undefined;
  });
  const timer = setTimeout(() => fail('Grok usage collection timed out.'), options.timeoutMs ?? 15_000);
  const cancel = () => fail('Grok usage collection cancelled.');
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  function request(id: number, method: string, params: unknown): Promise<unknown> {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      pending = { id, resolve, reject };
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  try {
    await request(1, 'initialize', { protocolVersion: 1, clientCapabilities: {},
      clientInfo: { name: 'bb-provider-usage', version: '1' } });
    const billing = billingSchema.safeParse(await request(2, '_x.ai/billing', {}));
    if (!billing.success) return unavailable('Grok subscription quota unavailable.');
    const period = billing.data.config.currentPeriod;
    const weekly = period?.type === 'USAGE_PERIOD_TYPE_WEEKLY';
    return { accountKey: null, observedAt: Date.now(), usage: { status: 'ok', ...fields,
      planLabel: billing.data.subscription_tier ?? null,
      windows: [{ id: 'shared', label: weekly ? 'Weekly' : 'Shared allowance', kind: weekly ? 'weekly' : 'custom',
        usedPercent: billing.data.config.creditUsagePercent, resetsAt: period?.end ?? null, model: null, cost: null }],
    } };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : 'Grok usage unavailable.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    lines.close();
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 1000);
    await closed;
    clearTimeout(force);
    await rm(directory, { recursive: true, force: true });
  }
}
