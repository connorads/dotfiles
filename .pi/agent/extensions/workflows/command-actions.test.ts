import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { handleWorkflowsCommand, type WorkflowCommandDeps } from "./command-actions.ts";
import { parseRunId, type RunId, type WorkflowInput, type WorkflowRunSnapshot } from "./domain.ts";
import { type WorkflowLaunch, type WorkflowLaunchOptions, type WorkflowManagerError } from "./manager.ts";
import type { AgentRunner, AgentRunResult } from "./runtime.ts";
import { ok, type Result } from "./result.ts";
import { createWorkflowStore, type WorkflowStore } from "./store.ts";

test("command and menu resume use the same completed-run confirmation path", async () => {
  const { deps, manager, ui, run } = await commandFixture({ status: "completed", result: "done", summary: "Done" });

  ui.confirmResponses.push(false);
  await handleWorkflowsCommand(`resume ${run.runId}`, deps);
  assert.equal(manager.resumeCalls.length, 0);
  assert.deepEqual(ui.notifications.at(-1), { message: "Resume cancelled.", level: "info" });

  ui.selectResponses.push(`${run.runId} completed workflow`, "Resume");
  ui.confirmResponses.push(false);
  await handleWorkflowsCommand("menu", deps);
  assert.equal(manager.resumeCalls.length, 0);
  assert.deepEqual(ui.notifications.at(-1), { message: "Resume cancelled.", level: "info" });
});

test("command and menu stop delegate through the same action copy", async () => {
  const { deps, manager, ui, run } = await commandFixture({ status: "running" });

  await handleWorkflowsCommand(`stop ${run.runId}`, deps);
  assert.deepEqual(manager.stopCalls, [run.runId]);
  assert.deepEqual(ui.notifications.at(-1), { message: `Stopped workflow ${run.runId}.`, level: "info" });

  ui.selectResponses.push(`${run.runId} running workflow`, "Stop");
  await handleWorkflowsCommand("menu", deps);
  assert.deepEqual(manager.stopCalls, [run.runId, run.runId]);
  assert.deepEqual(ui.notifications.at(-1), { message: `Stopped workflow ${run.runId}.`, level: "info" });
});

class RecordingUi {
  readonly notifications: Array<{ readonly message: string; readonly level: string }> = [];
  readonly confirmResponses: boolean[] = [];
  readonly selectResponses: string[] = [];

  notify(message: string, level: string): void {
    this.notifications.push({ message, level });
  }

  async confirm(): Promise<boolean> {
    return this.confirmResponses.shift() ?? false;
  }

  async select(): Promise<string | undefined> {
    return this.selectResponses.shift();
  }
}

class RecordingManager {
  readonly resumeCalls: RunId[] = [];
  readonly stopCalls: RunId[] = [];

  async launch(input: WorkflowInput, _options: WorkflowLaunchOptions): Promise<Result<WorkflowLaunch, WorkflowManagerError>> {
    return ok({
      status: "async_launched",
      taskId: "wf_command1",
      taskType: "local_workflow",
      runId: mustRunId("wf_command1"),
      workflowName: "workflow",
      summary: `Launched ${"name" in input ? input.name : "workflow"}.`,
    });
  }

  async resume(runId: RunId, _options: WorkflowLaunchOptions): Promise<Result<WorkflowLaunch, WorkflowManagerError>> {
    this.resumeCalls.push(runId);
    return ok({
      status: "async_launched",
      taskId: runId,
      taskType: "local_workflow",
      runId,
      workflowName: "workflow",
      summary: `Resumed ${runId}.`,
    });
  }

  async stop(runId: RunId, store: WorkflowStore): Promise<Result<WorkflowRunSnapshot, WorkflowManagerError>> {
    this.stopCalls.push(runId);
    const run = await store.readRun(runId);
    if (!run.ok) throw run.error;
    return ok({ ...run.value, status: "stopped", summary: "Stopped by user." });
  }

  isActive(): boolean {
    return false;
  }
}

class EmptyRunner implements AgentRunner {
  async run(): Promise<AgentRunResult> {
    return { value: null, outputTokens: 0 };
  }
}

async function commandFixture(over: Partial<Omit<WorkflowRunSnapshot, "runId" | "schemaVersion">> = {}): Promise<{
  readonly deps: WorkflowCommandDeps;
  readonly manager: RecordingManager;
  readonly ui: RecordingUi;
  readonly run: WorkflowRunSnapshot;
}> {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-actions-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const run = makeSnapshot(over);
  await store.createRun(run, `export const meta = { name: "workflow", description: "t" };\nreturn null;`);
  const manager = new RecordingManager();
  const ui = new RecordingUi();
  const deps: WorkflowCommandDeps = {
    manager,
    store,
    cwd: temp,
    hasUI: true,
    ui,
    agentRunner: new EmptyRunner(),
    toolPolicy: () => ({ toolAllowlist: ["read"], excludedTools: ["workflow"] }),
    refreshWidget: async () => {},
    now: () => 100,
  };
  return { deps, manager, ui, run };
}

function makeSnapshot(over: Partial<Omit<WorkflowRunSnapshot, "runId" | "schemaVersion">> = {}): WorkflowRunSnapshot {
  return {
    schemaVersion: 2,
    runId: mustRunId("wf_command1"),
    projectKey: "project",
    cwd: "/tmp/project",
    status: "queued",
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
