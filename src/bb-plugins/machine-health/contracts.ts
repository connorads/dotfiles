import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import type { Gauge, RawGauge } from './src/gauge.ts';
import type { Machine, Vitals } from './src/present.ts';
import type { AppGroup, ThreadUsage } from './src/triage.ts';

const pct = z.number().min(0).max(100);
const state = z.enum(['OK', 'BUSY', 'CRITICAL']);
const armName = z.enum(['slots', 'segments']);
const pressure = z.union([z.literal(1), z.literal(2), z.literal(4)]);

export const rawGaugeSchema = z.object({
  pressure, pages: z.number(), pagesLimit: z.number(), segments: z.number(), segmentsLimit: z.number(),
  pageSize: z.number(), segmentSize: z.number(), swapUsedMb: z.number(), swapTotalMb: z.number(), wiredMb: z.number(),
});
const arm = z.object({
  arm: armName, pct: z.number(), state,
  gap: z.object({ points: z.number(), to: z.enum(['to amber', 'to red', 'over red']) }),
  usedGib: z.number(), limitGib: z.number(),
});
const gaugeSchema = z.object({
  state, cause: z.enum(['none', 'pressure', 'slots', 'segments']), pressure, token: z.string(),
  slots: arm, segments: arm,
  ratio: z.object({ now: z.number(), limits: z.number(), fillsFirst: armName }),
  swapUsedMb: z.number(), swapTotalMb: z.number(), wiredMb: z.number(),
});

export const vitalsSchema = z.object({
  hostname: z.string(),
  platform: z.enum(['darwin', 'linux', 'other']),
  arch: z.string(),
  uptimeSec: z.number().nullable(),
  cores: z.number().int(),
  load1: z.number(),
  cpuPct: pct.nullable(),
  memory: z.object({ usedPct: pct, usedBytes: z.number(), totalBytes: z.number() }).nullable(),
  disk: z.object({ usedPct: pct, freeBytes: z.number(), totalBytes: z.number() }).nullable(),
  battery: z.object({ pct, onAc: z.boolean(), charging: z.boolean() }).nullable(),
  ssh: z.object({ inbound: z.number().int(), outbound: z.number().int(), agent: z.enum(['keys', 'empty', 'down', 'unchecked']) }).nullable(),
  reboot: z.enum(['debian', 'nixos']).nullable(),
  sampledAt: z.number(),
});
export const sampleSchema = z.object({ vitals: vitalsSchema, memory: rawGaugeSchema.nullable() });

const machineSchema = z.object({
  hostId: z.string(),
  name: z.string(),
  isServer: z.boolean(),
  status: z.enum(['connected', 'disconnected']),
  lastSeenAt: z.number().nullable(),
  vitals: vitalsSchema.nullable(),
  gauge: gaugeSchema.nullable(),
  error: z.string().nullable(),
});

const work = z.object({ command: z.string(), processes: z.number().int() });
const appGroup = z.object({
  app: z.string(), mb: z.number(), count: z.number(),
  processes: z.array(z.object({ pid: z.number(), mb: z.number(), command: z.string(), owner: z.enum(['thread', 'bb']).nullable() })),
});
const threadUsage = z.object({ threadId: z.string(), rootPid: z.number(), mb: z.number(), processes: z.number(), work: work.nullable() });
export const triageSampleSchema = z.object({ raw: rawGaugeSchema, apps: z.array(appGroup), threads: z.array(threadUsage) });

// The pure core owns the types; these fail to compile if a schema drifts from them.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const matches: [
  Same<z.infer<typeof rawGaugeSchema>, RawGauge>, Same<z.infer<typeof gaugeSchema>, Gauge>,
  Same<z.infer<typeof vitalsSchema>, Vitals>, Same<z.infer<typeof machineSchema>, Machine>,
  Same<z.infer<typeof appGroup>, AppGroup>, Same<z.infer<typeof threadUsage>, ThreadUsage>,
] = [true, true, true, true, true, true];
void matches;

const terminateResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
const pid = z.number().int().positive();
const command = z.string().min(1);

/** Runs on the machine being read. Triage, processes and terminate need macOS tools. */
export const hostContract = defineRpcContract({
  /** Vitals, plus compressor counters on macOS. Each probe fails soft. */
  sample: { input: z.object({}), output: sampleSchema },
  /** Every process's footprint, grouped by app, and each bb thread's provider tree. */
  triage: { input: z.object({}), output: triageSampleSchema },
  /** Each listed thread's provider process and the live work below it; absent threads have none. */
  processes: {
    input: z.object({ threadIds: z.array(z.string()) }),
    output: z.object({ threads: z.array(z.object({ threadId: z.string(), work: work.nullable() })) }),
  },
  /** SIGTERM one process, only if the pid still runs the command the user saw. */
  terminate: { input: z.object({ pid, command }), output: terminateResult },
});

const threadRow = z.object({ threadId: z.string(), title: z.string(), mb: z.number(), refusal: z.string().nullable() });
const outcome = z.discriminatedUnion('outcome', [
  z.object({ threadId: z.string(), outcome: z.enum(['hibernated', 'still-running']) }),
  z.object({ threadId: z.string(), outcome: z.enum(['refused', 'failed']), reason: z.string() }),
]);
const threadId = z.string().min(1);
const hostId = z.string().min(1);

export const rpcContract = defineRpcContract({
  /** The thread's machine, for the chip and the dialog; null when the thread has no environment yet. */
  thread: { input: z.object({ threadId }), output: z.object({ machine: machineSchema.nullable() }) },
  /** Every enrolled machine, for the sidebar footer. */
  machines: { input: z.object({}), output: z.object({ machines: z.array(machineSchema) }) },
  /** What holds memory on the thread's machine; macOS only. */
  triage: {
    input: z.object({ threadId }),
    output: z.object({ hostId, gauge: gaugeSchema, apps: z.array(appGroup), threads: z.array(threadRow), action: z.string() }),
  },
  hibernate: {
    input: z.object({ hostId, threadIds: z.array(threadId).min(1).max(50) }),
    output: z.object({ outcomes: z.array(outcome), summary: z.string() }),
  },
  terminate: { input: z.object({ hostId, pid, command }), output: terminateResult },
});

export type ThreadRowData = z.infer<typeof threadRow>;
export type TriageData = z.infer<(typeof rpcContract)['triage']['output']>;
export type Outcome = z.infer<typeof outcome>;
