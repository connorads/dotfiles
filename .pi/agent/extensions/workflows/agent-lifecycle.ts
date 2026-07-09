import type {
  AgentOptions,
  ReplayKey,
  WorkflowAgentSnapshot,
  WorkflowRunSnapshot,
} from "./domain.ts";
import type { Instant } from "./prelude.ts";

/** Input needed to record a freshly started workflow agent call. */
export interface StartAgentInput {
  readonly replayKey: ReplayKey;
  readonly prompt: string;
  readonly options: AgentOptions;
  readonly phase?: string;
  readonly now: Instant;
}

/** Snapshot plus the durable one-based agent index assigned to the call. */
export interface StartedAgent {
  readonly snapshot: WorkflowRunSnapshot;
  readonly index: number;
}

/** Add a running agent call to a workflow snapshot. */
export function startAgent(snapshot: WorkflowRunSnapshot, input: StartAgentInput): StartedAgent {
  const index = snapshot.agentCalls + 1;
  return {
    index,
    snapshot: {
      ...snapshot,
      agentCalls: index,
      agents: upsertAgent(snapshot.agents, {
        index,
        replayKey: input.replayKey,
        prompt: input.prompt,
        label: input.options.label,
        phase: input.phase,
        status: "running",
        startedAt: input.now,
        updatedAt: input.now,
      }),
      updatedAt: input.now,
    },
  };
}

/** Mark an agent call as replayed from the journal and account for its tokens. */
export function markAgentCached(
  snapshot: WorkflowRunSnapshot,
  index: number,
  outputTokens: number,
  now: Instant,
): WorkflowRunSnapshot {
  return {
    ...snapshot,
    budgetSpent: snapshot.budgetSpent + Math.max(0, outputTokens),
    agents: patchAgent(snapshot.agents, index, {
      status: "cached",
      outputTokens,
      updatedAt: now,
      completedAt: now,
    }),
    updatedAt: now,
  };
}

/** Mark an agent call as completed and account for its tokens. */
export function markAgentCompleted(
  snapshot: WorkflowRunSnapshot,
  index: number,
  outputTokens: number,
  now: Instant,
): WorkflowRunSnapshot {
  return {
    ...snapshot,
    budgetSpent: snapshot.budgetSpent + Math.max(0, outputTokens),
    agents: patchAgent(snapshot.agents, index, {
      status: "completed",
      outputTokens,
      updatedAt: now,
      completedAt: now,
    }),
    updatedAt: now,
  };
}

/** Mark an agent call as failed while preserving the rest of the run snapshot. */
export function markAgentFailed(
  snapshot: WorkflowRunSnapshot,
  index: number,
  error: string,
  now: Instant,
): WorkflowRunSnapshot {
  return {
    ...snapshot,
    agents: patchAgent(snapshot.agents, index, {
      status: "failed",
      error,
      updatedAt: now,
      completedAt: now,
    }),
    updatedAt: now,
  };
}

/** Refresh the last-observed activity timestamp for a running agent. */
export function touchAgentProgress(
  snapshot: WorkflowRunSnapshot,
  index: number,
  now: Instant,
): WorkflowRunSnapshot {
  return {
    ...snapshot,
    agents: patchAgent(snapshot.agents, index, { updatedAt: now }),
    updatedAt: now,
  };
}

function upsertAgent(agents: readonly WorkflowAgentSnapshot[], next: WorkflowAgentSnapshot): WorkflowAgentSnapshot[] {
  const existing = agents.findIndex((agent) => agent.index === next.index);
  if (existing === -1) return [...agents, next];
  return agents.map((agent, index) => (index === existing ? next : agent));
}

function patchAgent(
  agents: readonly WorkflowAgentSnapshot[],
  index: number,
  patch: Partial<Omit<WorkflowAgentSnapshot, "index" | "replayKey" | "prompt" | "startedAt">>,
): WorkflowAgentSnapshot[] {
  return agents.map((agent) => (agent.index === index ? { ...agent, ...patch } : agent));
}
