import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseRunId, type RunId, type WorkflowRunSnapshot } from "./domain.ts";
import { parseCommandRunId, parseRunCommand, WorkflowManager } from "./manager.ts";
import type { AgentRunner, AgentRunResult } from "./runtime.ts";
import { createWorkflowStore } from "./store.ts";

test("parseRunCommand parses named workflows and JSON args", () => {
  const parsed = parseRunCommand('review {"limit":2,"strict":true}');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.name, "review");
  assert.deepEqual(parsed.value.args, { limit: 2, strict: true });
});

test("parseRunCommand treats js/path targets as script paths", () => {
  const js = parseRunCommand("audit.js");
  assert.equal(js.ok, true);
  if (!js.ok) return;
  assert.equal(js.value.scriptPath, "audit.js");

  const path = parseRunCommand("./.pi/workflows/audit");
  assert.equal(path.ok, true);
  if (!path.ok) return;
  assert.equal(path.value.scriptPath, "./.pi/workflows/audit");
});

test("parseRunCommand returns errors for missing target or invalid JSON args", () => {
  assert.equal(parseRunCommand("").ok, false);
  const badJson = parseRunCommand("audit {nope}");
  assert.equal(badJson.ok, false);
  assert.match(badJson.ok ? "" : badJson.error.message, /Invalid JSON args/u);
});

test("parseCommandRunId accepts Pi workflow ids only", () => {
  assert.equal(parseCommandRunId("wf_abcdef").ok, true);
  assert.equal(parseCommandRunId("not-a-run").ok, false);
  assert.equal(parseCommandRunId(undefined).ok, false);
});

test("WorkflowManager persists thrown workflow failures as failed snapshots", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-manager-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const manager = new WorkflowManager();
  const delivered: WorkflowRunSnapshot[] = [];

  const launch = await manager.launch(
    {
      script: `
export const meta = { name: "throws" };
throw new Error("boom");
`,
    },
    {
      cwd: temp,
      store,
      agentRunner: new EmptyRunner(),
      deliver: (snapshot) => delivered.push(snapshot),
    },
  );
  assert.equal(launch.ok, true);
  if (!launch.ok) return;

  const run = await waitForTerminalRun(store, launch.value.runId);
  assert.equal(run.status, "failed");
  assert.equal(run.error, "boom");
  assert.equal(run.summary, "Failed: boom");
  assert.equal(delivered.at(-1)?.status, "failed");
});

test("parseRunCommand preserves whitespace inside JSON string args", () => {
  const parsed = parseRunCommand('greet {"msg":"hello  world"}');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.args, { msg: "hello  world" });
});

test("launch with resumeFromRunId resumes the pinned script and ignores the supplied source", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-pin-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const manager = new WorkflowManager();
  const options = { cwd: temp, store, agentRunner: new EmptyRunner() };

  const launch = await manager.launch({ script: `export const meta = { name: "pin" };\nreturn "original";` }, options);
  assert.equal(launch.ok, true);
  if (!launch.ok) return;
  const first = await waitForTerminalRun(store, launch.value.runId);
  assert.equal(first.status, "completed");
  assert.equal(first.result, "original");

  const resumed = await manager.launch(
    { script: `export const meta = { name: "pin" };\nreturn "different";`, resumeFromRunId: launch.value.runId },
    options,
  );
  assert.equal(resumed.ok, true);
  const after = await waitForTerminalRun(store, launch.value.runId);
  assert.equal(after.status, "completed");
  assert.equal(after.result, "original");
});

test("resume errors on an unknown run id instead of minting a fresh run", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-unknown-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const manager = new WorkflowManager();
  const options = { cwd: temp, store, agentRunner: new EmptyRunner() };

  const viaResume = await manager.resume(mustRunId("wf_missing01"), options);
  assert.equal(viaResume.ok, false);

  const viaLaunch = await manager.launch(
    { script: `export const meta = {};\nreturn 1;`, resumeFromRunId: "wf_missing01" },
    options,
  );
  assert.equal(viaLaunch.ok, false);
});

test("stop does not overwrite a terminal run summary", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-stopterm-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const manager = new WorkflowManager();

  const launch = await manager.launch(
    { script: `export const meta = { name: "done" };\nreturn "finished";` },
    { cwd: temp, store, agentRunner: new EmptyRunner() },
  );
  assert.equal(launch.ok, true);
  if (!launch.ok) return;
  const terminal = await waitForTerminalRun(store, launch.value.runId);
  assert.equal(terminal.status, "completed");

  const stopped = await manager.stop(launch.value.runId, store);
  assert.equal(stopped.ok, true);
  if (!stopped.ok) return;
  assert.equal(stopped.value.status, "completed");
  assert.equal(stopped.value.summary, terminal.summary);
  assert.notEqual(stopped.value.summary, "Stopped by user.");
});

class EmptyRunner implements AgentRunner {
  async run(): Promise<AgentRunResult> {
    return { value: null, outputTokens: 0 };
  }
}

function mustRunId(value: string): RunId {
  const parsed = parseRunId(value);
  if (parsed.ok) return parsed.value;
  throw parsed.error;
}

async function waitForTerminalRun(
  store: ReturnType<typeof createWorkflowStore>,
  runId: RunId,
): Promise<WorkflowRunSnapshot> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = await store.readRun(runId);
    assert.equal(run.ok, true);
    if (!run.ok) continue;
    if (run.value.status === "completed" || run.value.status === "failed" || run.value.status === "stopped") {
      return run.value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const run = await store.readRun(runId);
  assert.equal(run.ok, true);
  if (!run.ok) throw new Error("workflow run disappeared");
  return run.value;
}
