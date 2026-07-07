import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseRunId, type RunId, type WorkflowRunSnapshot } from "./domain.ts";
import { resolveRequestedModel, thinkingLevelForEffort } from "./model-select.ts";
import { parseWorkflowScript, type ParsedWorkflowScript } from "./parser.ts";
import { WorkflowRuntime, type AgentRunner, type AgentRunResult, type WorkflowRuntimeDeps } from "./runtime.ts";
import { createWorkflowStore } from "./store.ts";

test("runtime executes agents, parallel, pipeline, phases, logs, and replay", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-runtime-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const source = `
export const meta = { name: "demo", description: "t", phases: ["Setup"], budget: 100 };
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
export const meta = { name: "child", description: "t" };
phase("ignored");
log("child log");
const out = await agent("child prompt", { label: "child-agent" });
return { out, args };
`,
    "utf8",
  );

  const source = `
export const meta = { name: "parent", description: "t" };
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

test("workflow body cannot reach a host Function through .constructor", async () => {
  const escapes = [
    `return log.constructor("return process")().pid;`,
    `return agent.constructor("return this")();`,
    `const r = await agent("x"); return r.constructor.constructor("return process")();`,
    `const p = await parallel([() => agent("x")]); return p[0].constructor.constructor("return process")();`,
    `const p = await parallel([() => agent("x")]); return p.constructor.constructor("return process")();`,
  ];
  for (const body of escapes) {
    const runtime = makeRuntime(`export const meta = { name: "t", description: "t" };\n${body}`, new RecordingRunner());
    await assert.rejects(runtime.execute(runtime.parsed), /Code generation from strings disallowed/u, body);
  }
});

test("workflow determinism: real Date/Math are unreachable but explicit dates work", async () => {
  const bypass = makeRuntime(`export const meta = { name: "t", description: "t" };\nreturn Object.getPrototypeOf(Math).random();`, new RecordingRunner());
  await assert.rejects(bypass.execute(bypass.parsed), /random is not a function/u);

  const aliasedDate = makeRuntime(`export const meta = { name: "t", description: "t" };\nconst D = Date;\nreturn new D().getTime();`, new RecordingRunner());
  await assert.rejects(aliasedDate.execute(aliasedDate.parsed), /without explicit arguments/u);

  const explicitDate = makeRuntime(`export const meta = { name: "t", description: "t" };\nreturn new Date("2026-01-02").getFullYear();`, new RecordingRunner());
  assert.equal(await explicitDate.execute(explicitDate.parsed), 2026);
});

test("parallel and pipeline throw WorkflowBudgetExceededError once the budget is spent", async () => {
  for (const call of ["parallel([() => agent(\"two\")])", "pipeline([1], () => agent(\"two\"))"]) {
    // The first agent spends 7 tokens, exhausting the budget of 5 before the
    // parallel/pipeline entry precheck runs.
    const runtime = makeRuntime(
      `export const meta = { name: "t", description: "t", budget: 5 };\nawait agent("one");\nreturn await ${call};`,
      new RecordingRunner(),
      { budgetTotal: 5 },
    );
    await assert.rejects(runtime.execute(runtime.parsed), /token budget exceeded/u, call);
  }
});

test("a stalled agent is aborted and fails its call", async () => {
  const runtime = makeRuntime(`export const meta = { name: "t", description: "t" };\nreturn await agent("hang", { stallMs: 20 });`, new HangingRunner());
  await assert.rejects(runtime.execute(runtime.parsed), /stalled after 20ms/u);
  assert.ok(runtime.getSnapshot().logs.some((line) => line.includes("stalled after 20ms")));
});

test("an agent emitting progress past the stall deadline is not aborted", async () => {
  const runtime = makeRuntime(
    `export const meta = { name: "t", description: "t" };\nreturn await agent("slow", { stallMs: 30 });`,
    new ProgressingRunner(90, 10),
  );
  assert.equal(await runtime.execute(runtime.parsed), "slow-done");
});

test("agent isolation worktree and remote both throw", async () => {
  for (const isolation of ["worktree", "remote"]) {
    const runtime = makeRuntime(
      `export const meta = { name: "t", description: "t" };\nreturn await agent("x", { isolation: "${isolation}" });`,
      new RecordingRunner(),
    );
    await assert.rejects(runtime.execute(runtime.parsed), new RegExp(`isolation:'${isolation}'`, "u"), isolation);
  }
});

test("agentType logs a visible warning and is ignored", async () => {
  const runner = new RecordingRunner();
  const runtime = makeRuntime(
    `export const meta = { name: "t", description: "t" };\nreturn await agent("x", { agentType: "code-reviewer" });`,
    runner,
  );
  await runtime.execute(runtime.parsed);
  assert.equal(runner.calls.length, 1);
  assert.ok(
    runtime.getSnapshot().logs.some((line) => line.includes("agentType") && line.includes("code-reviewer")),
    runtime.getSnapshot().logs.join("\n"),
  );
});

test("null agent results are not journalled and re-run on resume", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-null-"));
  const store = createWorkflowStore(join(temp, "project"), join(temp, "root"));
  const source = `export const meta = { name: "n", description: "t" };\nreturn await agent("x");`;
  const parsed = mustParse(source);
  const snapshot = makeSnapshot("wf_nulljrnl1", { workflowName: "n" });
  await store.createRun(snapshot, source);

  const first = new NullRunner();
  const runtime = new WorkflowRuntime(snapshot, [], baseDeps(store, first));
  assert.equal(await runtime.execute(parsed), null);
  assert.equal(first.calls, 1);

  const journal = await store.readJournal(snapshot.runId);
  assert.equal(journal.filter((entry) => entry.kind === "agent_result").length, 0);
  assert.equal(journal.filter((entry) => entry.kind === "agent_started").length, 1);

  const second = new RecordingRunner();
  const replay = new WorkflowRuntime(makeSnapshot("wf_nulljrnl1", { workflowName: "n" }), journal, baseDeps(store, second));
  assert.deepEqual(await replay.execute(parsed), { prompt: "x", label: null, phase: null });
  assert.equal(second.calls.length, 1);
});

test("resolveRequestedModel matches by id, provider/id, then name, and rejects unknowns", () => {
  const sonnet = { id: "claude-sonnet-5", name: "Claude Sonnet 5", provider: "anthropic" };
  const mini = { id: "o4-mini", name: "o4 mini", provider: "openai" };
  const registry = {
    getAvailable: () => [sonnet, mini],
    find: (provider: string, id: string) =>
      [sonnet, mini].find((model) => model.provider === provider && model.id === id),
  };

  assert.equal(resolveRequestedModel(registry, "claude-sonnet-5"), sonnet);
  assert.equal(resolveRequestedModel(registry, "openai/o4-mini"), mini);
  assert.equal(resolveRequestedModel(registry, "Claude Sonnet 5"), sonnet);
  assert.throws(() => resolveRequestedModel(registry, "gpt-99"), /Unknown agent model: gpt-99/u);
});

test("thinkingLevelForEffort passes through known levels, maps max, rejects unknowns", () => {
  assert.equal(thinkingLevelForEffort("low"), "low");
  assert.equal(thinkingLevelForEffort("medium"), "medium");
  assert.equal(thinkingLevelForEffort("high"), "high");
  assert.equal(thinkingLevelForEffort("xhigh"), "xhigh");
  assert.equal(thinkingLevelForEffort("max"), "xhigh");
  assert.throws(() => thinkingLevelForEffort("ultra"), /Unknown agent effort: ultra/u);
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

class NullRunner implements AgentRunner {
  calls = 0;

  async run(): Promise<AgentRunResult> {
    this.calls += 1;
    return { value: null, outputTokens: 3 };
  }
}

class HangingRunner implements AgentRunner {
  async run(_prompt: string, options: Parameters<AgentRunner["run"]>[1]): Promise<AgentRunResult> {
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  }
}

/** Emits onProgress every `stepMs` until finishing after `totalMs`. */
class ProgressingRunner implements AgentRunner {
  private readonly totalMs: number;
  private readonly stepMs: number;

  constructor(totalMs: number, stepMs: number) {
    this.totalMs = totalMs;
    this.stepMs = stepMs;
  }

  async run(prompt: string, options: Parameters<AgentRunner["run"]>[1]): Promise<AgentRunResult> {
    const started = Date.now();
    while (Date.now() - started < this.totalMs) {
      if (options.signal.aborted) throw new Error("aborted");
      await new Promise((resolve) => setTimeout(resolve, this.stepMs));
      options.onProgress?.();
    }
    return { value: `${prompt}-done`, outputTokens: 1 };
  }
}

function baseDeps(store: ReturnType<typeof createWorkflowStore>, agentRunner: AgentRunner): WorkflowRuntimeDeps {
  return { store, agentRunner, signal: new AbortController().signal, now: clock(), concurrency: 4 };
}

function makeRuntime(
  source: string,
  agentRunner: AgentRunner,
  over: Partial<Omit<WorkflowRunSnapshot, "runId" | "schemaVersion">> = {},
): WorkflowRuntime & { readonly parsed: ParsedWorkflowScript } {
  const store = createWorkflowStore(join(tmpdir(), "pi-workflows-inline"), join(tmpdir(), "pi-workflows-inline-root"));
  const snapshot = makeSnapshot("wf_inline001", over);
  const runtime = new WorkflowRuntime(snapshot, [], baseDeps(store, agentRunner));
  return Object.assign(runtime, { parsed: mustParse(source) });
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
