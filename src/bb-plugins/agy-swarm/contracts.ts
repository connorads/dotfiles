import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const memberStateSchema = z.enum(['working', 'waiting', 'blocked', 'done', 'killed', 'error']);
export type MemberState = z.infer<typeof memberStateSchema>;

export const swarmStatusSchema = z.enum(['working', 'blocked', 'done', 'stopped', 'waiting']);
export type SwarmStatus = z.infer<typeof swarmStatusSchema>;

export const swarmMemberSchema = z.object({
  name: z.string(),
  conversationId: z.string(),
  role: z.string(),
  model: z.string().nullable(),
  workspaceMode: z.string(),
  wakeMode: z.string(),
  state: memberStateSchema,
  activity: z.string().nullable(),
  stepCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  lastActiveAt: z.string().nullable(),
  killed: z.boolean(),
});
export type SwarmMember = z.infer<typeof swarmMemberSchema>;

export const boardMessageSchema = z.object({
  seq: z.number().int().nonnegative(),
  agent: z.string(),
  text: z.string(),
  time: z.string().nullable(),
  kind: z.string().nullable(),
  channel: z.string(),
  mentions: z.array(z.string()),
  isDone: z.boolean(),
  isStall: z.boolean(),
});
export type BoardMessage = z.infer<typeof boardMessageSchema>;

export const planThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string().nullable(),
  tasks: z.array(z.string()),
});
export type PlanThread = z.infer<typeof planThreadSchema>;

export const swarmPlanSchema = z.object({
  goalTitle: z.string().nullable(),
  goalLine: z.string().nullable(),
  tasks: z.record(z.string(), z.string()),
  threads: z.array(planThreadSchema),
});
export type SwarmPlan = z.infer<typeof swarmPlanSchema>;

export const swarmSnapshotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unsupported'), providerId: z.string().nullable() }),
  z.object({ kind: z.literal('no-session'), providerId: z.string() }),
  z.object({ kind: z.literal('none'), providerId: z.string(), sessionId: z.string() }),
  z.object({
    kind: z.literal('swarm'),
    providerId: z.string(),
    sessionId: z.string(),
    swarmId: z.string(),
    title: z.string().nullable(),
    createdAt: z.string().nullable(),
    boardHead: z.number().int().nonnegative(),
    channels: z.array(z.string()),
    plan: swarmPlanSchema.nullable(),
    members: z.array(swarmMemberSchema),
    messages: z.array(boardMessageSchema),
    summary: z.object({
      totalWorkers: z.number().int().nonnegative(),
      workingWorkers: z.number().int().nonnegative(),
      doneWorkers: z.number().int().nonnegative(),
      blockedWorkers: z.number().int().nonnegative(),
      killedWorkers: z.number().int().nonnegative(),
      waitingWorkers: z.number().int().nonnegative(),
      errorWorkers: z.number().int().nonnegative(),
      status: swarmStatusSchema,
      lastActivityAt: z.string().nullable(),
      active: z.boolean(),
    }),
  }),
]);
export type SwarmSnapshot = z.infer<typeof swarmSnapshotSchema>;

export const workerToolCallSchema = z.object({
  name: z.string(),
  argsPreview: z.string().nullable(),
});

export const workerStepSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  time: z.string().nullable(),
  source: z.string(),
  type: z.string(),
  status: z.string(),
  model: z.string().nullable(),
  toolCalls: z.array(workerToolCallSchema),
  text: z.string().nullable(),
  thinking: z.string().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
});
export type WorkerStep = z.infer<typeof workerStepSchema>;

export const workerLogResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    member: z.string(),
    conversationId: z.string(),
    totalSteps: z.number().int().nonnegative(),
    steps: z.array(workerStepSchema),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type WorkerLogResult = z.infer<typeof workerLogResultSchema>;

const providerId = z.string().min(1);
const sessionId = z.string().min(1);
const threadId = z.string().min(1);
const member = z.string().min(1);

export const hostContract = defineRpcContract({
  snapshot: { input: z.object({ providerId, sessionId }), output: swarmSnapshotSchema },
  workerLog: { input: z.object({ providerId, sessionId, member }), output: workerLogResultSchema },
  fingerprint: { input: z.object({ providerId, sessionId }), output: z.string().nullable() },
});

export const rpcContract = defineRpcContract({
  snapshot: { input: z.object({ threadId }), output: swarmSnapshotSchema },
  workerLog: { input: z.object({ threadId, member }), output: workerLogResultSchema },
  fingerprint: { input: z.object({ threadId }), output: z.string().nullable() },
});
