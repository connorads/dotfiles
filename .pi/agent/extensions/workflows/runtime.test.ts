import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseRunId, type RunId, type WorkflowRunSnapshot } from "./domain.ts";
import { parseWorkflowScript, type ParsedWorkflowScript } from "./parser.ts";
import { WorkflowRuntime, type AgentRunner, type AgentRunResult } from "./runtime.ts";
import { createWorkflowStore } from "./store.ts";

test("runtime executes agents, parallel, pipeline, phases, logs, and replay", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-runtime-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const source = `
export const meta = { name: "demo", phases: ["Setup"], budget: 100 };
phase("Plan");
log("started");
const one = await agent("first", { label: "one" });
const par = await parallel([
  () => agent("second", { label: "two" }),
  () => { throw new Error("boom"); },
]);
const piped = await pipeline([1, 2, 3], x => x + 1, x => x === 3 ? null : x);
return { one, par, piped, remaining: budget.remaining() };
`;
  const parsed = mustParse(source);
  const snapshot = makeSnapshot("wf_runtime01", { workflowName: "demo", budgetTotal: 100 });
  await store.createRun(snapshot, source);

  const runner = new RecordingRunner();
  const runtime = new WorkflowRuntime(snapshot, [], {
    store,
    agentRunner: runner,
    signal: new AbortController().signal,
    now: clock(),
    concurrency: 4,
  });

  const result = await runtime.execute(parsed);
  assert.deepEqual(result, {
    one: { prompt: "first", label: "one", phase: "Plan" },
    par: [{ prompt: "second", label: "two", phase: "Plan" }, null],
    piped: [2, null, 4],
    remaining: 86,
  });
  assert.deepEqual(runner.calls.map((call) => call.prompt), ["first", "second"]);

  const after = runtime.getSnapshot();
  assert.equal(after.agentCalls, 2);
  assert.equal(after.budgetSpent, 14);
  assert.deepEqual(after.phases, ["Plan"]);
  assert.ok(after.logs.includes("started"));
  assert.ok(after.logs.some((line) => line.includes("parallel[1] failed: boom")));

  const journal = await store.readJournal(snapshot.runId);
  assert.equal(journal.filter((entry) => entry.kind === "agent_result").length, 2);

  const replayRunner = new RecordingRunner();
  const replaySnapshot = makeSnapshot("wf_runtime01", { workflowName: "demo", budgetTotal: 100 });
  await store.updateRun(replaySnapshot);
  const replayRuntime = new WorkflowRuntime(replaySnapshot, journal, {
    store,
    agentRunner: replayRunner,
    signal: new AbortController().signal,
    now: clock(),
    concurrency: 4,
  });

  assert.deepEqual(await replayRuntime.execute(parsed), result);
  assert.equal(replayRunner.calls.length, 0);
  assert.equal(replayRuntime.getSnapshot().agentCalls, 2);
  assert.equal(replayRuntime.getSnapshot().budgetSpent, 14);
  assert.ok(replayRuntime.getSnapshot().logs.some((line) => line.includes("agent[1] cached: one")));
});

test("runtime runs one-level child workflows with forced child agent phase", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-child-"));
  const project = join(temp, "project");
  const root = join(temp, "root");
  const scripts = join(project, ".pi", "workflows");
  await mkdir(scripts, { recursive: true });
  await writeFile(
    join(scripts, "child.js"),
    `
export const meta = { name: "child" };
phase("ignored");
log("child log");
const out = await agent("child prompt", { label: "child-agent" });
return { out, args };
`,
    "utf8",
  );

  const source = `
export const meta = { name: "parent" };
const child = await workflow("child", { answer: 42 });
return { child };
`;
  const store = createWorkflowStore(project, root);
  const parsed = mustParse(source);
  const snapshot = makeSnapshot("wf_child01", { workflowName: "parent" });
  await store.createRun(snapshot, source);

  const runner = new RecordingRunner();
  const runtime = new WorkflowRuntime(snapshot, [], {
    store,
    agentRunner: runner,
    signal: new AbortController().signal,
    now: clock(),
  });

  assert.deepEqual(await runtime.execute(parsed), {
    child: {
      out: { prompt: "child prompt", label: "child-agent", phase: "child:child" },
      args: { answer: 42 },
    },
  });
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0]?.phase, "child:child");
  assert.deepEqual(runtime.getSnapshot().phases, []);
  assert.ok(runtime.getSnapshot().logs.includes("[child] child log"));
});

class RecordingRunner implements AgentRunner {
  readonly calls: Array<{ readonly prompt: string; readonly label: string | null; readonly phase: string | null }> = [];

  async run(prompt: string, options: Parameters<AgentRunner["run"]>[1]): Promise<AgentRunResult> {
    const call = {
      prompt,
      label: options.label ?? null,
      phase: options.phase ?? null,
    };
    this.calls.push(call);
    return { value: call, outputTokens: 7 };
  }
}

function mustParse(source: string): ParsedWorkflowScript {
  const parsed = parseWorkflowScript(source);
  if (parsed.ok) return parsed.value;
  throw parsed.error;
}

function makeSnapshot(
  id: string,
  over: Partial<Omit<WorkflowRunSnapshot, "runId" | "schemaVersion">> = {},
): WorkflowRunSnapshot {
  const runId = mustRunId(id);
  return {
    schemaVersion: 1,
    runId,
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

function clock(): () => number {
  let value = 1000;
  return () => {
    value += 1;
    return value;
  };
}
