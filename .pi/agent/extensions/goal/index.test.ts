import test from "node:test";
import assert from "node:assert/strict";

import goalExtension, { createGoalEngine } from "./index.ts";
import {
  GOAL_ENTRY_TYPE,
  type GoalEvent,
  type GoalMode,
  type GoalState,
  reduceGoal,
} from "./core.ts";
import type { GoalRuntime } from "./runtime.ts";

const auto = (over: Partial<Extract<GoalMode, { kind: "auto" }>> = {}): GoalMode => ({
  kind: "auto",
  tokenBudget: 1000,
  maxIterations: 5,
  tokensUsed: 0,
  iteration: 0,
  noProgressCount: 0,
  ...over,
});
const steer = (): GoalMode => ({ kind: "steer" });

// An assistant message in the shape the metering reads.
const asst = (output: number, stopReason = "stop", over: Record<string, unknown> = {}) => ({
  role: "assistant",
  usage: { input: 0, output, cacheRead: 0 },
  stopReason,
  ...over,
});

// ---------------------------------------------------------------------------
// A type-honest in-memory GoalRuntime fake (implements the port exactly).
// readEvents reflects record(), so the engine exercises its real read-fold path.
// ---------------------------------------------------------------------------

function fakeRuntime(seed: GoalEvent[] = []) {
  const events: GoalEvent[] = [...seed];
  const continuations: string[] = [];
  let toolsActive = false;
  let shown: GoalState = null;
  let clock = 0;
  let percent: number | null = null;
  // One-shot hook fired *during* a cooldown sleep, to simulate a concurrent event
  // (command / tree navigation) interleaving the 2s window that `await rt.sleep` opens.
  let sleepHook: (() => void | Promise<void>) | null = null;

  const rt: GoalRuntime = {
    readEvents: () => events.slice(),
    record: (event) => {
      events.push(event);
    },
    sendContinuation: (kick) => {
      continuations.push(kick);
    },
    contextPercent: () => percent,
    setGoalToolsActive: (active) => {
      toolsActive = active;
    },
    showStatus: (state) => {
      shown = state;
    },
    now: () => ++clock,
    sleep: async () => {
      const hook = sleepHook;
      sleepHook = null;
      if (hook) await hook();
    },
  };

  return {
    rt,
    events,
    continuations,
    get toolsActive() {
      return toolsActive;
    },
    get shown() {
      return shown;
    },
    state: () => reduceGoal(events),
    progressCount: () => events.filter((e) => e.kind === "progress").length,
    setPercent: (p: number | null) => {
      percent = p;
    },
    setSleepHook: (fn: (() => void | Promise<void>) | null) => {
      sleepHook = fn;
    },
  };
}

// ---------------------------------------------------------------------------
// Engine integration (fake GoalRuntime)
// ---------------------------------------------------------------------------

test("set: persists, kicks one continuation, activates tools (auto)", () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto());
  assert.equal(f.state()?.text, "Ship X");
  assert.equal(f.state()?.status, "active");
  assert.equal(f.continuations.length, 1);
  assert.equal(f.toolsActive, true);
});

test("self-driving: a clean run records progress and kicks the next turn", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto());
  engine.onAgentStart(); // kicked turn begins (clears in-flight flag)
  await engine.onAgentEnd(f.rt, [asst(100)]);
  assert.equal(f.progressCount(), 1);
  assert.equal(f.continuations.length, 2); // set kick + loop kick
  assert.equal(f.state()?.status, "active");
  assert.equal(f.state()?.mode.kind === "auto" && f.state()?.mode.iteration, 1);
});

test("budget: one wrap-up turn is kicked, then the loop stops", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto({ tokenBudget: 100 }));
  engine.onAgentStart();
  await engine.onAgentEnd(f.rt, [asst(60, "stop", { usage: { input: 200, output: 60, cacheRead: 0 } })]);
  assert.equal(f.state()?.status, "budget_limited");
  assert.equal(f.continuations.at(-1), "The active goal has reached its token budget. Do not start new substantive work — wrap up this turn.");
  const afterWrapKick = f.continuations.length;

  // The wrap-up turn ends: no further continuation.
  engine.onAgentStart();
  await engine.onAgentEnd(f.rt, [asst(10)]);
  assert.equal(f.continuations.length, afterWrapKick);
  assert.equal(f.state()?.status, "budget_limited");
});

test("no-progress: three low-output runs pause the loop (stuck)", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto({ tokenBudget: 1_000_000, maxIterations: 50 }));
  for (let i = 0; i < 3; i++) {
    engine.onAgentStart();
    await engine.onAgentEnd(f.rt, [asst(5)]); // < NO_PROGRESS_OUTPUT_TOKENS
  }
  assert.equal(f.state()?.status, "paused");
  // set kick + two loop kicks (turn 3 pauses instead of kicking)
  assert.equal(f.continuations.length, 3);
});

test("max-iterations: the loop pauses at the cap (counters restored from events on reload)", async () => {
  // Seed as if a prior session already ran two turns — simulates reload.
  const seed: GoalEvent[] = [
    { kind: "set", text: "Ship X", at: 1, mode: auto({ maxIterations: 3 }) },
    { kind: "progress", at: 2, promptCost: 10, outputTokens: 100 },
    { kind: "progress", at: 3, promptCost: 10, outputTokens: 100 },
  ];
  const f = fakeRuntime(seed);
  const engine = createGoalEngine();
  assert.equal(f.state()?.mode.kind === "auto" && f.state()?.mode.iteration, 2); // restored
  engine.onAgentStart();
  await engine.onAgentEnd(f.rt, [asst(100)]); // iteration → 3 == max
  assert.equal(f.state()?.status, "paused");
  assert.equal(f.continuations.length, 0); // no kick on the capping turn
});

test("context-full: the loop pauses near the context ceiling", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto());
  f.setPercent(97);
  engine.onAgentStart();
  await engine.onAgentEnd(f.rt, [asst(100)]);
  assert.equal(f.state()?.status, "paused");
});

test("abort: an aborted run pauses without counting progress or continuing", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto());
  const kicksAfterSet = f.continuations.length;
  engine.onAgentStart();
  await engine.onAgentEnd(f.rt, [asst(100, "aborted")]);
  assert.equal(f.progressCount(), 0);
  assert.equal(f.continuations.length, kicksAfterSet); // no loop kick
  assert.equal(f.state()?.status, "paused");
});

test("fatal error: the loop marks the goal blocked", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto());
  engine.onAgentStart();
  await engine.onAgentEnd(f.rt, [asst(100, "error", { errorMessage: "invalid api key" })]);
  assert.equal(f.state()?.status, "blocked");
});

test("human takeover: an interactive message yields the loop; commands/extension input do not", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto());
  engine.onAgentStart();
  engine.onInput("extension", "Continue working toward the active goal."); // our own kick — ignored
  engine.onInput("interactive", "/goal status"); // slash command — ignored
  engine.onInput("interactive", "actually do it this way"); // human takeover
  await engine.onAgentEnd(f.rt, [asst(100)]);
  assert.equal(f.state()?.status, "paused");
  assert.equal(f.progressCount(), 0);
});

test("dedup: two agent_end events without an agent_start kick only once", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto());
  engine.onAgentStart();
  await engine.onAgentEnd(f.rt, [asst(100)]); // continues (flag stays set)
  await engine.onAgentEnd(f.rt, [asst(100)]); // no intervening agent_start → bails
  assert.equal(f.progressCount(), 1);
  assert.equal(f.continuations.length, 2); // set kick + one loop kick
});

test("update_goal complete: a clean summary is accepted and stops the loop", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto());
  const reply = engine.execUpdateGoal(f.rt, "complete", "All requirements verified against current state; tests green.");
  assert.match(reply.content[0].text, /complete/);
  assert.equal(f.state()?.status, "complete");
  // A subsequent run does not continue a completed goal.
  engine.onAgentStart();
  await engine.onAgentEnd(f.rt, [asst(100)]);
  assert.equal(f.continuations.length, 1); // only the original set kick
});

test("update_goal complete: a contradictory summary is rejected (throws), goal stays active", () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto());
  assert.throws(() => engine.execUpdateGoal(f.rt, "complete", "Mostly done but tests still failing."));
  assert.equal(f.state()?.status, "active");
});

test("update_goal blocked: accepted and stops the loop", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto());
  engine.execUpdateGoal(f.rt, "blocked", "Impasse: needs a production credential only the user can provide.");
  assert.equal(f.state()?.status, "blocked");
  engine.onAgentStart();
  await engine.onAgentEnd(f.rt, [asst(100)]);
  assert.equal(f.continuations.length, 1);
});

test("steer-only: anchors but never self-drives and never enables tools", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", steer());
  assert.equal(f.continuations.length, 0); // no kick
  assert.equal(f.toolsActive, false);
  assert.match(engine.beforeAgentStart(f.rt, "BASE")!, /Ship X/);
  engine.onAgentStart();
  await engine.onAgentEnd(f.rt, [asst(100)]);
  assert.equal(f.progressCount(), 0);
  assert.equal(f.continuations.length, 0);
});

test("anchor: injected while active/driving, withheld while paused", () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto());
  assert.match(engine.beforeAgentStart(f.rt, "BASE")!, /^BASE/);
  assert.match(engine.beforeAgentStart(f.rt, "BASE")!, /Completion audit/);
  engine.applyPause(f.rt);
  assert.equal(engine.beforeAgentStart(f.rt, "BASE"), undefined);
});

test("tail: injected once per turn when active, again after a new turn, absent when paused", () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto({ tokensUsed: 0, tokenBudget: 1000 }));
  engine.onAgentStart(); // opens the tail gate

  const out = engine.onContext(f.rt, [{ role: "user", content: "go", timestamp: 1 }]);
  assert.ok(out);
  const merged = out![0];
  assert.ok(Array.isArray(merged.content));
  assert.match(JSON.stringify(merged.content), /update_goal/);

  // Gate closed: a second context call in the same turn injects nothing.
  assert.equal(engine.onContext(f.rt, [{ role: "user", content: "go", timestamp: 1 }]), undefined);

  // New turn reopens the gate.
  engine.onTurnStart();
  assert.ok(engine.onContext(f.rt, [{ role: "user", content: "go", timestamp: 1 }]));

  // Paused → no tail.
  engine.applyPause(f.rt);
  engine.onTurnStart();
  assert.equal(engine.onContext(f.rt, [{ role: "user", content: "go", timestamp: 1 }]), undefined);
});

test("tail: budget_limited turn injects the wrap-up message", () => {
  const seed: GoalEvent[] = [
    { kind: "set", text: "Ship X", at: 1, mode: auto({ tokensUsed: 1000, tokenBudget: 1000 }) },
    { kind: "status", at: 2, status: "budget_limited", reason: "budget" },
  ];
  const f = fakeRuntime(seed);
  const engine = createGoalEngine();
  engine.onAgentStart();
  const out = engine.onContext(f.rt, [{ role: "user", content: "go", timestamp: 1 }]);
  assert.match(JSON.stringify(out), /reached its token budget/);
});

test("tail: merges into a trailing user message rather than appending a second one", () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto());
  engine.onAgentStart();
  const out = engine.onContext(f.rt, [{ role: "user", content: "original", timestamp: 1 }])!;
  assert.equal(out.length, 1); // still one user message
  assert.equal(out[0].role, "user");
});

test("resume: resets the runway and re-kicks (auto)", async () => {
  const seed: GoalEvent[] = [
    { kind: "set", text: "Ship X", at: 1, mode: auto({ maxIterations: 3 }) },
    { kind: "progress", at: 2, promptCost: 10, outputTokens: 5 },
    { kind: "progress", at: 3, promptCost: 10, outputTokens: 5 },
    { kind: "status", at: 4, status: "paused", reason: "stuck" },
  ];
  const f = fakeRuntime(seed);
  const engine = createGoalEngine();
  engine.applyResume(f.rt);
  assert.equal(f.state()?.status, "active");
  assert.equal(f.state()?.mode.kind === "auto" && f.state()?.mode.iteration, 0);
  assert.equal(f.continuations.length, 1); // re-kick
});

test("session_tree: drops the in-flight continuation so a stale loop does not fire", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Ship X", auto());
  engine.onAgentStart();
  await engine.onAgentEnd(f.rt, [asst(100)]); // continues; flag set
  engine.onSessionTree(f.rt); // navigation clears the flag
  // Without an agent_start, a fresh agent_end would normally bail on the flag;
  // after onSessionTree it processes again (new branch context).
  await engine.onAgentEnd(f.rt, [asst(100)]);
  assert.equal(f.progressCount(), 2);
});

test("cooldown race: setting a new goal during the cooldown does not double-kick", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Goal A", auto()); // continuation #1 (A)
  engine.onAgentStart();
  // The user sets a new goal while onAgentEnd is in its cooldown sleep.
  f.setSleepHook(() => {
    engine.applySet(f.rt, "Goal B", auto()); // continuation #2 (B)
  });
  await engine.onAgentEnd(f.rt, [asst(100)]);
  // The stale onAgentEnd (for Goal A) must NOT add a third continuation.
  assert.equal(f.continuations.length, 2);
  assert.equal(f.state()?.text, "Goal B");
});

test("cooldown race: tree navigation during the cooldown cancels the stale continuation", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Goal A", auto()); // continuation #1
  engine.onAgentStart();
  f.setSleepHook(() => {
    engine.onSessionTree(f.rt);
  });
  await engine.onAgentEnd(f.rt, [asst(100)]);
  assert.equal(f.continuations.length, 1); // no stale loop continuation after navigating away
});

test("cooldown race: pause during the cooldown stops the loop", async () => {
  const f = fakeRuntime();
  const engine = createGoalEngine();
  engine.applySet(f.rt, "Goal A", auto()); // continuation #1
  engine.onAgentStart();
  f.setSleepHook(() => {
    engine.applyPause(f.rt);
  });
  await engine.onAgentEnd(f.rt, [asst(100)]);
  assert.equal(f.continuations.length, 1); // paused mid-cooldown → no extra kick
  assert.equal(f.state()?.status, "paused");
});

// ---------------------------------------------------------------------------
// Wiring / adapter integration (drives the default export through a pi+ctx fake,
// exercising createPiRuntime, registration, command dispatch, and tool execute).
// ---------------------------------------------------------------------------

function harness(seed: GoalEvent[] = []) {
  const entries = seed.map((data) => ({ type: "custom" as const, customType: GOAL_ENTRY_TYPE, data }));
  let widget: string[] | undefined;
  const notes: string[] = [];
  let editorReply: string | undefined;
  let activeTools: string[] = [];
  const sent: { content: unknown; deliverAs?: string }[] = [];
  let percent: number | null = null;

  const ctx = {
    hasUI: true,
    sessionManager: { getBranch: () => entries.slice() },
    getContextUsage: () => (percent === null ? undefined : { tokens: 1, contextWindow: 100, percent }),
    ui: {
      setWidget: (_key: string, content: string[] | undefined) => {
        widget = content;
      },
      notify: (message: string) => notes.push(message),
      editor: async () => editorReply,
    },
  };

  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<{ content: { text: string }[] }> }>();
  let command: ((args: string, ctx: unknown) => Promise<void>) | undefined;
  const flags = new Map<string, boolean | string>();

  const pi = {
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(event, handler),
    registerCommand: (_name: string, opts: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
      command = opts.handler;
    },
    registerTool: (def: { name: string; execute: (...a: unknown[]) => Promise<{ content: { text: string }[] }> }) =>
      tools.set(def.name, def),
    registerFlag: (name: string, opts: { default?: boolean | string }) => flags.set(name, opts.default ?? false),
    getFlag: (name: string) => flags.get(name),
    appendEntry: (customType: string, data: unknown) =>
      entries.push({ type: "custom" as const, customType: customType as typeof GOAL_ENTRY_TYPE, data: data as GoalEvent }),
    sendUserMessage: (content: unknown, options?: { deliverAs?: string }) => sent.push({ content, deliverAs: options?.deliverAs }),
    getActiveTools: () => activeTools.slice(),
    setActiveTools: (names: string[]) => {
      activeTools = names;
    },
  };

  goalExtension(pi as unknown as Parameters<typeof goalExtension>[0]);

  return {
    get widget() {
      return widget;
    },
    notes,
    sent,
    get activeTools() {
      return activeTools;
    },
    setEditorReply: (v: string | undefined) => {
      editorReply = v;
    },
    setFlag: (name: string, value: boolean | string) => flags.set(name, value),
    setPercent: (p: number | null) => {
      percent = p;
    },
    entries,
    fire: (event: string, payload: unknown = {}) => handlers.get(event)?.(payload, ctx),
    run: (args: string) => command!(args, ctx),
    tool: (name: string) => tools.get(name)!,
    ctx,
    inject: () =>
      handlers.get("before_agent_start")!({ systemPrompt: "BASE" }, ctx) as { systemPrompt: string } | undefined,
  };
}

test("wiring: /goal set persists, shows a widget, kicks a continuation, activates tools", async () => {
  const h = harness();
  await h.run("Ship the OAuth refactor");
  assert.match(h.widget!.join(" "), /Ship the OAuth refactor/);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].deliverAs, "followUp");
  assert.ok(h.activeTools.includes("update_goal"));
  assert.match(h.inject()!.systemPrompt, /Ship the OAuth refactor/);
});

test("wiring: --steer-only is anchor-only (no kick, no tools), exactly like v1", async () => {
  const h = harness();
  await h.run("--steer-only Do the thing");
  assert.equal(h.sent.length, 0);
  assert.equal(h.activeTools.includes("update_goal"), false);
  assert.match(h.inject()!.systemPrompt, /Do the thing/);
  assert.doesNotMatch(h.inject()!.systemPrompt, /Completion audit/);
});

test("wiring: invalid flag value is reported, no goal set", async () => {
  const h = harness();
  await h.run("--tokens nope ship it");
  assert.match(h.notes.at(-1)!, /Invalid --tokens/);
  assert.equal(reduceGoal(h.entries.map((e) => e.data as GoalEvent)), null);
});

test("wiring: the registered update_goal tool rejects a contradictory completion", async () => {
  const h = harness();
  await h.run("Ship X");
  await assert.rejects(h.tool("update_goal").execute("id", { status: "complete", summary: "tests still failing" }, undefined, undefined, h.ctx));
});

test("wiring: the registered get_goal tool reports status", async () => {
  const h = harness();
  await h.run("Ship X");
  const result = await h.tool("get_goal").execute("id", {}, undefined, undefined, h.ctx);
  assert.match(result.content[0].text, /Ship X/);
});

test("wiring: resume/pause on a completed goal are refused and preserve the terminal state", async () => {
  const h = harness([
    { kind: "set", text: "Done thing", at: 1, mode: auto() },
    { kind: "status", at: 2, status: "complete", reason: "model_complete" },
  ]);
  h.fire("session_start");
  await h.run("resume");
  assert.match(h.notes.at(-1)!, /complete/);
  await h.run("pause");
  assert.match(h.notes.at(-1)!, /complete/);
  // No re-activation: the goal is still complete and never re-kicked.
  assert.equal(reduceGoal(h.entries.map((e) => e.data as GoalEvent))?.status, "complete");
  assert.equal(h.sent.length, 0);
});

test("wiring: a pre-existing goal on the branch is restored on session_start", () => {
  const h = harness([{ kind: "set", text: "Inherited", at: 1, mode: auto() }]);
  h.fire("session_start");
  assert.match(h.widget!.join(" "), /Inherited/);
  assert.match(h.inject()!.systemPrompt, /Inherited/);
});

test("wiring: bare /goal shows; /goal status reports the budget", async () => {
  const h = harness();
  await h.run("");
  assert.match(h.notes.at(-1)!, /No active goal/);
  await h.run("Some goal");
  await h.run("status");
  assert.match(h.notes.at(-1)!, /self-driving/);
});

test("wiring: --no-auto flag makes new goals steer-only by default (but --auto/--tokens still opt in)", async () => {
  const h = harness();
  h.setFlag("no-auto", true);

  await h.run("plain objective");
  assert.equal(h.sent.length, 0); // steer-only by default → no kick
  assert.equal(h.activeTools.includes("update_goal"), false);

  await h.run("--tokens 5k explicit auto"); // explicit budget overrides the default
  assert.equal(h.sent.length, 1);
});

test("wiring: compaction-proof — anchor depends only on the goal entry, not chat history", async () => {
  const h = harness();
  await h.run("Persistent objective");
  assert.match(h.inject()!.systemPrompt, /Persistent objective/);
});
