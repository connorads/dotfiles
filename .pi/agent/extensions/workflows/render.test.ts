import assert from "node:assert/strict";
import test from "node:test";

import { parseRunId, type RunId, type WorkflowRunSnapshot } from "./domain.ts";
import { defaultRunTarget, renderCompletionMessage, renderRun, renderRunDetails, renderWidget } from "./render.ts";

test("defaultRunTarget prefers the single active run, else the most recent", () => {
  const running = makeRun("wf_running01", { status: "running", updatedAt: 50 });
  const older = makeRun("wf_older0001", { status: "completed", updatedAt: 100 });
  const newer = makeRun("wf_newer0001", { status: "failed", updatedAt: 200 });

  assert.equal(defaultRunTarget([newer, older, running]), running);
  assert.equal(defaultRunTarget([newer, older]), newer);
  const second = makeRun("wf_second001", { status: "queued", updatedAt: 10 });
  assert.equal(defaultRunTarget([newer, running, second]), newer);
  assert.equal(defaultRunTarget([]), undefined);
});

test("renderWidget shows live runs with phase, agents, and relative activity", () => {
  const run = makeRun("wf_widget001", {
    status: "running",
    workflowName: "audit",
    agentCalls: 3,
    phases: ["Scan", "Verify"],
    updatedAt: 55_000,
  });
  const lines = renderWidget([run], 60_000);
  assert.equal(lines.length, 2);
  assert.match(lines[1] ?? "", /running wf_widget001 audit \(agents 3, phase Verify, 5s ago\)/u);
});

test("renderWidget keeps terminal runs visible for a minute, then hides them", () => {
  const done = makeRun("wf_done00001", { status: "completed", completedAt: 100_000 });
  assert.equal(renderWidget([done], 130_000).length, 2);
  assert.deepEqual(renderWidget([done], 200_000), []);
  assert.deepEqual(renderWidget([], 0), []);
});

test("renderRun shows elapsed/last-activity and a recovery hint on failure", () => {
  const failed = makeRun("wf_failed001", {
    status: "failed",
    startedAt: 0,
    updatedAt: 120_000,
    completedAt: 120_000,
    summary: "Failed: boom",
  });
  const text = renderRun(failed, false, 180_000);
  assert.match(text, /elapsed 2m, last activity 1m ago/u);
  assert.match(text, /Recover: edit the pinned script and run \/workflows resume wf_failed001/u);
});

test("renderRunDetails includes the run directory path", () => {
  const run = makeRun("wf_detail001", { status: "completed" });
  const text = renderRunDetails(run, "/tmp/runs/wf_detail001", 1);
  assert.match(text, /run dir: \/tmp\/runs\/wf_detail001/u);
});

test("renderCompletionMessage appends recovery and run dir for stopped runs", () => {
  const stopped = makeRun("wf_stopped01", { status: "stopped", summary: "Stopped by user." });
  const text = renderCompletionMessage(stopped, "/tmp/runs/wf_stopped01");
  assert.match(text, /Workflow stopped: workflow/u);
  assert.match(text, /Recover: edit the pinned script/u);
  assert.match(text, /Run dir: \/tmp\/runs\/wf_stopped01/u);

  const completed = makeRun("wf_ok0000001", { status: "completed", summary: "done" });
  assert.doesNotMatch(renderCompletionMessage(completed, "/tmp/x"), /Recover:/u);
});

function makeRun(id: string, over: Partial<Omit<WorkflowRunSnapshot, "runId" | "schemaVersion">> = {}): WorkflowRunSnapshot {
  return {
    schemaVersion: 1,
    runId: mustRunId(id),
    projectKey: "project",
    cwd: "/tmp/project",
    status: "queued",
    workflowName: "workflow",
    sourceKind: "inline",
    sourceHash: "hash",
    scriptFile: "script.js",
    args: null,
    meta: {},
    budgetTotal: null,
    budgetSpent: 0,
    agentCalls: 0,
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
