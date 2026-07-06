import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RunId, WorkflowRunSnapshot } from "./domain.ts";
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

class EmptyRunner implements AgentRunner {
  async run(): Promise<AgentRunResult> {
    return { value: null, outputTokens: 0 };
  }
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
