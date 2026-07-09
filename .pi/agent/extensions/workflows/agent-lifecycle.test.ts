import assert from "node:assert/strict";
import test from "node:test";

import {
  markAgentCached,
  markAgentCompleted,
  markAgentFailed,
  startAgent,
  touchAgentProgress,
} from "./agent-lifecycle.ts";
import { nextReplayKey, parseRunId, type ReplayKey, type RunId, type WorkflowRunSnapshot } from "./domain.ts";

test("startAgent appends a running agent with the next durable index", () => {
  const started = startAgent(makeSnapshot(), {
    replayKey: replayKey("rk_1"),
    prompt: "inspect",
    options: { label: "Inspect", model: "fast" },
    phase: "Discovery",
    now: 20,
  });

  assert.equal(started.index, 1);
  assert.equal(started.snapshot.agentCalls, 1);
  assert.deepEqual(started.snapshot.agents, [
    {
      index: 1,
      replayKey: replayKey("rk_1"),
      prompt: "inspect",
      label: "Inspect",
      phase: "Discovery",
      status: "running",
      startedAt: 20,
      updatedAt: 20,
    },
  ]);
  assert.equal(started.snapshot.updatedAt, 20);
});

test("cached and completed agents add only non-negative output tokens", () => {
  const started = startAgent(makeSnapshot({ budgetSpent: 3 }), {
    replayKey: replayKey("rk_1"),
    prompt: "inspect",
    options: {},
    now: 20,
  });

  const cached = markAgentCached(started.snapshot, started.index, -4, 30);
  assert.equal(cached.budgetSpent, 3);
  assert.equal(cached.agents[0]?.status, "cached");
  assert.equal(cached.agents[0]?.completedAt, 30);

  const completed = markAgentCompleted(cached, started.index, 7, 40);
  assert.equal(completed.budgetSpent, 10);
  assert.equal(completed.agents[0]?.status, "completed");
  assert.equal(completed.agents[0]?.outputTokens, 7);
  assert.equal(completed.agents[0]?.completedAt, 40);
});

test("failed and progress transitions update only the targeted agent", () => {
  const one = startAgent(makeSnapshot(), {
    replayKey: replayKey("rk_1"),
    prompt: "one",
    options: {},
    now: 10,
  });
  const two = startAgent(one.snapshot, {
    replayKey: replayKey("rk_2"),
    prompt: "two",
    options: {},
    now: 20,
  });

  const touched = touchAgentProgress(two.snapshot, 2, 30);
  assert.equal(touched.agents[0]?.updatedAt, 10);
  assert.equal(touched.agents[1]?.updatedAt, 30);

  const failed = markAgentFailed(touched, 1, "boom", 40);
  assert.equal(failed.agents[0]?.status, "failed");
  assert.equal(failed.agents[0]?.error, "boom");
  assert.equal(failed.agents[0]?.completedAt, 40);
  assert.equal(failed.agents[1]?.status, "running");
});

function makeSnapshot(over: Partial<Omit<WorkflowRunSnapshot, "runId" | "schemaVersion">> = {}): WorkflowRunSnapshot {
  return {
    schemaVersion: 2,
    runId: mustRunId("wf_lifecycle1"),
    projectKey: "project",
    cwd: "/tmp/project",
    status: "running",
    workflowName: "workflow",
    sourceKind: "inline",
    sourceHash: "hash",
    scriptFile: "script.js",
    args: null,
    meta: {},
    toolAllowlist: ["read"],
    excludedTools: ["workflow"],
    budgetTotal: null,
    budgetSpent: 0,
    agentCalls: 0,
    agents: [],
    phases: [],
    logs: [],
    startedAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function mustRunId(value: string): RunId {
  const parsed = parseRunId(value);
  if (parsed.ok) return parsed.value;
  throw parsed.error;
}

function replayKey(value: string): ReplayKey {
  return nextReplayKey("", value, {});
}
