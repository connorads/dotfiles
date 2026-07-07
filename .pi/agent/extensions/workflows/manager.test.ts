import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseRunId, type RunId, type WorkflowRunSnapshot } from "./domain.ts";
import { parseCommandRunId, parseRunCommand, WorkflowManager } from "./manager.ts";
import type { AgentRunner, AgentRunResult } from "./runtime.ts";
import { createWorkflowStore, workflowProjectKey } from "./store.ts";

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
export const meta = { name: "throws", description: "t" };
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

test("bare resumeFromRunId resumes the run's pinned script", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-pin-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const manager = new WorkflowManager();
  const options = { cwd: temp, store, agentRunner: new EmptyRunner() };

  const launch = await manager.launch({ script: `export const meta = { name: "pin", description: "t" };\nreturn "original";` }, options);
  assert.equal(launch.ok, true);
  if (!launch.ok) return;
  const first = await waitForTerminalRun(store, launch.value.runId);
  assert.equal(first.status, "completed");
  assert.equal(first.result, "original");

  const resumed = await manager.launch({ resumeFromRunId: launch.value.runId }, options);
  assert.equal(resumed.ok, true);
  const after = await waitForTerminalRun(store, launch.value.runId);
  assert.equal(after.status, "completed");
  assert.equal(after.result, "original");
});

test("resume with a supplied source re-pins the script and re-runs only the changed suffix", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-repin-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const manager = new WorkflowManager();
  const runner = new PromptRecordingRunner();
  const options = { cwd: temp, store, agentRunner: runner };

  const original = `export const meta = { name: "edit", description: "t" };\nconst a = await agent("a");\nreturn [a, await agent("b")];`;
  const launch = await manager.launch({ script: original }, options);
  assert.equal(launch.ok, true);
  if (!launch.ok) return;
  const first = await waitForTerminalRun(store, launch.value.runId);
  assert.equal(first.status, "completed");
  assert.deepEqual(runner.prompts, ["a", "b"]);

  const edited = `export const meta = { name: "edit-v2", description: "t" };\nconst a = await agent("a");\nreturn [a, await agent("c")];`;
  const resumed = await manager.launch({ script: edited, resumeFromRunId: launch.value.runId }, options);
  assert.equal(resumed.ok, true);
  const after = await waitForTerminalRun(store, launch.value.runId);
  assert.equal(after.status, "completed");
  assert.equal(after.workflowName, "edit-v2");
  assert.deepEqual(after.result, ["ran:a", "ran:c"]);
  // The unchanged prefix replays from the journal; only the edited call re-runs.
  assert.deepEqual(runner.prompts, ["a", "b", "c"]);

  const pinned = await store.readRunScript(launch.value.runId);
  assert.equal(pinned.ok, true);
  if (!pinned.ok) return;
  assert.equal(pinned.value, edited);
});

test("resume with two sources is still rejected", async () => {
  const manager = new WorkflowManager();
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-twosrc-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const rejected = await manager.launch(
    { script: `export const meta = { name: "t", description: "t" };\nreturn 1;`, name: "other", resumeFromRunId: "wf_abcdef01" },
    { cwd: temp, store, agentRunner: new EmptyRunner() },
  );
  assert.equal(rejected.ok, false);
});

test("resume errors on an unknown run id instead of minting a fresh run", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-unknown-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const manager = new WorkflowManager();
  const options = { cwd: temp, store, agentRunner: new EmptyRunner() };

  const viaResume = await manager.resume(mustRunId("wf_missing01"), options);
  assert.equal(viaResume.ok, false);

  const viaLaunch = await manager.launch(
    { script: `export const meta = { name: "t", description: "t" };\nreturn 1;`, resumeFromRunId: "wf_missing01" },
    options,
  );
  assert.equal(viaLaunch.ok, false);
});

test("reconcile marks stale running runs failed and sweeps orphaned tmp files", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-reconcile-"));
  const project = join(temp, "project");
  const root = join(temp, "root");
  const store = createWorkflowStore(project, root);
  const manager = new WorkflowManager();

  const stale = makeSnapshot("wf_stale0001", { status: "running", pid: 4_000_000 });
  const orphan = makeSnapshot("wf_orphan001", { status: "queued" });
  const alive = makeSnapshot("wf_alive0001", { status: "running", pid: process.pid });
  const done = makeSnapshot("wf_done00001", { status: "completed" });
  for (const snapshot of [stale, orphan, alive, done]) {
    await store.createRun(snapshot, `export const meta = { name: "t", description: "t" };\nreturn 1;`);
  }
  const staleDir = join(root, "projects", workflowProjectKey(project), "runs", stale.runId);
  await writeFile(join(staleDir, "run.json.123.abc.tmp"), "torn", "utf8");

  const reconciled = await manager.reconcile(store);
  assert.deepEqual(reconciled.map((run) => run.runId).sort(), [orphan.runId, stale.runId].sort());

  const staleAfter = await store.readRun(stale.runId);
  assert.equal(staleAfter.ok && staleAfter.value.status, "failed");
  assert.match(staleAfter.ok ? staleAfter.value.error ?? "" : "", /Interrupted - Pi exited mid-run/u);
  assert.match(staleAfter.ok ? staleAfter.value.error ?? "" : "", new RegExp(`resume ${stale.runId}`, "u"));
  const aliveAfter = await store.readRun(alive.runId);
  assert.equal(aliveAfter.ok && aliveAfter.value.status, "running");
  const doneAfter = await store.readRun(done.runId);
  assert.equal(doneAfter.ok && doneAfter.value.status, "completed");
  assert.deepEqual((await readdir(staleDir)).filter((name) => name.endsWith(".tmp")), []);
});

test("a superseded execution does not deliver its terminal snapshot", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-fence-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const manager = new WorkflowManager();
  const delivered: WorkflowRunSnapshot[] = [];

  const launch = await manager.launch(
    { script: `export const meta = { name: "slow", description: "t" };\nreturn await agent("hang");` },
    { cwd: temp, store, agentRunner: new AbortableRunner(), deliver: (snapshot) => delivered.push(snapshot) },
  );
  assert.equal(launch.ok, true);
  if (!launch.ok) return;

  // Give the launch a beat to reach the hanging agent, then stop it: stop
  // claims a new generation, so the aborted execution's deliver is fenced.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const stopped = await manager.stop(launch.value.runId, store);
  assert.equal(stopped.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const run = await store.readRun(launch.value.runId);
  assert.equal(run.ok && run.value.status, "stopped");
  assert.deepEqual(delivered, []);
});

test("execution records the owning pid on the running snapshot", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-pid-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const manager = new WorkflowManager();

  const launch = await manager.launch(
    { script: `export const meta = { name: "pid", description: "t" };\nreturn 1;` },
    { cwd: temp, store, agentRunner: new EmptyRunner() },
  );
  assert.equal(launch.ok, true);
  if (!launch.ok) return;
  const run = await waitForTerminalRun(store, launch.value.runId);
  assert.equal(run.pid, process.pid);
});

test("stop does not overwrite a terminal run summary", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-stopterm-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const manager = new WorkflowManager();

  const launch = await manager.launch(
    { script: `export const meta = { name: "done", description: "t" };\nreturn "finished";` },
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

class PromptRecordingRunner implements AgentRunner {
  readonly prompts: string[] = [];

  async run(prompt: string): Promise<AgentRunResult> {
    this.prompts.push(prompt);
    return { value: `ran:${prompt}`, outputTokens: 1 };
  }
}

class AbortableRunner implements AgentRunner {
  async run(_prompt: string, options: Parameters<AgentRunner["run"]>[1]): Promise<AgentRunResult> {
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  }
}

function makeSnapshot(id: string, over: Partial<Omit<WorkflowRunSnapshot, "runId" | "schemaVersion">> = {}): WorkflowRunSnapshot {
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
