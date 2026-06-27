import test from "node:test";
import assert from "node:assert/strict";

import {
  type ContinuationSignals,
  type GoalEvent,
  type GoalMode,
  type GoalState,
  type MessageLike,
  CONTINUATION_KICK,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_TOKEN_BUDGET,
  NO_PROGRESS_LIMIT,
  classifyError,
  computeOutputTokens,
  computePromptCost,
  decideCompletion,
  decideContinuation,
  goalToolsShouldBeActive,
  isDriving,
  lastAssistantStopReason,
  parseGoalCommand,
  parseGoalEvent,
  parseGoalOptions,
  parseTokenBudget,
  reduceGoal,
  renderGoalBlock,
  renderGoalStatus,
  renderGoalTail,
  summaryContradictsCompletion,
} from "./core.ts";

// Helper: an auto mode with explicit, small caps for deterministic tests.
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
const ev = (e: GoalEvent): GoalEvent => e;

// ---------------------------------------------------------------------------
// parseGoalCommand (v1 + status subcommand + options)
// ---------------------------------------------------------------------------

test("parseGoalCommand: bare and whitespace-only args show", () => {
  assert.deepEqual(parseGoalCommand(""), { kind: "show" });
  assert.deepEqual(parseGoalCommand("   "), { kind: "show" });
});

test("parseGoalCommand: reserved words are subcommands only when alone", () => {
  assert.deepEqual(parseGoalCommand("status"), { kind: "status" });
  assert.deepEqual(parseGoalCommand("edit"), { kind: "edit" });
  assert.deepEqual(parseGoalCommand("pause"), { kind: "pause" });
  assert.deepEqual(parseGoalCommand("resume"), { kind: "resume" });
  assert.deepEqual(parseGoalCommand("clear"), { kind: "clear" });
  assert.deepEqual(parseGoalCommand("  PAUSE "), { kind: "pause" });
});

test("parseGoalCommand: a reserved word with trailing text sets a goal (auto by default)", () => {
  const cmd = parseGoalCommand("pause the build");
  assert.equal(cmd.kind, "set");
  assert.equal(cmd.kind === "set" && cmd.text, "pause the build");
  assert.equal(cmd.kind === "set" && cmd.mode.kind, "auto");
});

test("parseGoalCommand: set preserves the objective and defaults to auto mode", () => {
  const cmd = parseGoalCommand("  Ship the OAuth refactor  ");
  assert.equal(cmd.kind, "set");
  if (cmd.kind !== "set") return;
  assert.equal(cmd.text, "Ship the OAuth refactor");
  assert.equal(cmd.mode.kind, "auto");
});

test("parseGoalCommand: --steer-only yields steer mode (exactly v1 behaviour)", () => {
  const cmd = parseGoalCommand("--steer-only Ship X");
  assert.equal(cmd.kind, "set");
  assert.equal(cmd.kind === "set" && cmd.text, "Ship X");
  assert.equal(cmd.kind === "set" && cmd.mode.kind, "steer");
});

test("parseGoalCommand: an invalid flag value surfaces as set_invalid", () => {
  assert.deepEqual(parseGoalCommand("--tokens abc do the thing"), {
    kind: "set_invalid",
    error: { field: "tokens", value: "abc" },
  });
});

// ---------------------------------------------------------------------------
// parseTokenBudget / parseGoalOptions (invalid vs absent; objective preserved)
// ---------------------------------------------------------------------------

test("parseTokenBudget: k/m suffixes, underscores, ints; rejects garbage", () => {
  assert.equal(parseTokenBudget("200000"), 200000);
  assert.equal(parseTokenBudget("200_000"), 200000);
  assert.equal(parseTokenBudget("200k"), 200000);
  assert.equal(parseTokenBudget("1.5m"), 1500000);
  assert.equal(parseTokenBudget("1K"), 1000);
  assert.equal(parseTokenBudget("abc"), null);
  assert.equal(parseTokenBudget(""), null);
  assert.equal(parseTokenBudget("0"), null);
  assert.equal(parseTokenBudget("-5"), null);
  // A huge literal that overflows to Infinity must be rejected, not silently uncap the budget.
  assert.equal(parseTokenBudget("9".repeat(303) + "m"), null);
});

test("parseGoalOptions: absent flags fall to defaults; objective is verbatim minus flags", () => {
  const r = parseGoalOptions("Ship the OAuth refactor");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.text, "Ship the OAuth refactor");
  assert.deepEqual(r.mode, auto({ tokenBudget: DEFAULT_TOKEN_BUDGET, maxIterations: DEFAULT_MAX_ITERATIONS }));
});

test("parseGoalOptions: flags anywhere are stripped, both = and space forms", () => {
  const r = parseGoalOptions("Fix --tokens=5k the bug --max-iter 3");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.text, "Fix the bug");
  assert.equal(r.mode.kind, "auto");
  if (r.mode.kind !== "auto") return;
  assert.equal(r.mode.tokenBudget, 5000);
  assert.equal(r.mode.maxIterations, 3);
});

test("parseGoalOptions: invalid token budget is an error value, not a throw", () => {
  assert.deepEqual(parseGoalOptions("--tokens nope ship it"), {
    ok: false,
    error: { field: "tokens", value: "nope" },
  });
});

test("parseGoalOptions: invalid max-iterations is an error value", () => {
  assert.deepEqual(parseGoalOptions("--max-iterations 0 ship it"), {
    ok: false,
    error: { field: "max-iterations", value: "0" },
  });
});

test("parseGoalOptions: defaultAuto=false yields steer unless auto is explicit", () => {
  // global --no-auto: plain objective defaults to steer
  assert.equal((parseGoalOptions("ship it", false) as { mode: GoalMode }).mode.kind, "steer");
  // but a budget flag (or --auto) still opts in
  assert.equal((parseGoalOptions("ship it --tokens 5k", false) as { mode: GoalMode }).mode.kind, "auto");
  assert.equal((parseGoalOptions("--auto ship it", false) as { mode: GoalMode }).mode.kind, "auto");
});

test("goalToolsShouldBeActive: only for an auto goal that is driving", () => {
  assert.equal(goalToolsShouldBeActive(null), false);
  assert.equal(goalToolsShouldBeActive({ text: "A", status: "active", mode: steer() }), false);
  assert.equal(goalToolsShouldBeActive({ text: "A", status: "active", mode: auto() }), true);
  assert.equal(goalToolsShouldBeActive({ text: "A", status: "budget_limited", mode: auto() }), true);
  assert.equal(goalToolsShouldBeActive({ text: "A", status: "paused", mode: auto() }), false);
  assert.equal(goalToolsShouldBeActive({ text: "A", status: "complete", mode: auto() }), false);
});

test("isDriving: active and budget_limited drive; others do not", () => {
  assert.equal(isDriving("active"), true);
  assert.equal(isDriving("budget_limited"), true);
  assert.equal(isDriving("paused"), false);
  assert.equal(isDriving("complete"), false);
  assert.equal(isDriving("blocked"), false);
});

// ---------------------------------------------------------------------------
// parseGoalEvent (valid round-trip; rejects malformed/old shapes)
// ---------------------------------------------------------------------------

test("parseGoalEvent: round-trips every valid event shape", () => {
  const events: GoalEvent[] = [
    { kind: "set", text: "A", at: 1, mode: auto() },
    { kind: "set", text: "B", at: 2, mode: steer() },
    { kind: "edit", text: "C", at: 3 },
    { kind: "pause", at: 4 },
    { kind: "resume", at: 5 },
    { kind: "clear", at: 6 },
    { kind: "progress", at: 7, promptCost: 10, outputTokens: 100 },
    { kind: "status", at: 8, status: "complete", reason: "model_complete" },
  ];
  for (const e of events) {
    assert.deepEqual(parseGoalEvent(JSON.parse(JSON.stringify(e))), e);
  }
});

test("parseGoalEvent: a v1 set without a mode defaults to steer (no surprise self-driving)", () => {
  assert.deepEqual(parseGoalEvent({ kind: "set", text: "Legacy", at: 1 }), {
    kind: "set",
    text: "Legacy",
    at: 1,
    mode: { kind: "steer" },
  });
});

test("parseGoalEvent: rejects malformed / unknown shapes", () => {
  assert.equal(parseGoalEvent(null), null);
  assert.equal(parseGoalEvent("nope"), null);
  assert.equal(parseGoalEvent({ kind: "set", at: 1 }), null); // missing text
  assert.equal(parseGoalEvent({ kind: "progress", at: 1 }), null); // missing numbers
  assert.equal(parseGoalEvent({ kind: "status", at: 1, status: "active", reason: "budget" }), null); // active is illegal
  assert.equal(parseGoalEvent({ kind: "status", at: 1, status: "paused", reason: "made_up" }), null);
  assert.equal(parseGoalEvent({ kind: "wat", at: 1 }), null);
});

// ---------------------------------------------------------------------------
// reduceGoal (mode init, progress accumulation, status, resume reset, branch)
// ---------------------------------------------------------------------------

test("reduceGoal: no events means no goal", () => {
  assert.equal(reduceGoal([]), null);
});

test("reduceGoal: set establishes an active goal carrying its mode", () => {
  assert.deepEqual(reduceGoal([ev({ kind: "set", text: "A", at: 1, mode: auto() })]), {
    text: "A",
    status: "active",
    mode: auto(),
  });
});

test("reduceGoal: latest set wins (and replaces the mode)", () => {
  assert.deepEqual(
    reduceGoal([
      ev({ kind: "set", text: "A", at: 1, mode: auto() }),
      ev({ kind: "set", text: "B", at: 2, mode: steer() }),
    ]),
    { text: "B", status: "active", mode: steer() },
  );
});

test("reduceGoal: edit changes text and preserves status + mode counters", () => {
  const state = reduceGoal([
    ev({ kind: "set", text: "A", at: 1, mode: auto() }),
    ev({ kind: "progress", at: 2, promptCost: 100, outputTokens: 200 }),
    ev({ kind: "pause", at: 3 }),
    ev({ kind: "edit", text: "A2", at: 4 }),
  ]);
  assert.equal(state?.text, "A2");
  assert.equal(state?.status, "paused");
  assert.equal(state?.mode.kind === "auto" && state.mode.tokensUsed, 100);
  assert.equal(state?.mode.kind === "auto" && state.mode.iteration, 1);
});

test("reduceGoal: progress accumulates tokens, iterations, and the no-progress streak", () => {
  const state = reduceGoal([
    ev({ kind: "set", text: "A", at: 1, mode: auto() }),
    ev({ kind: "progress", at: 2, promptCost: 100, outputTokens: 5 }), // no progress
    ev({ kind: "progress", at: 3, promptCost: 100, outputTokens: 5 }), // no progress
    ev({ kind: "progress", at: 4, promptCost: 100, outputTokens: 999 }), // resets streak
  ]);
  assert.equal(state?.mode.kind === "auto" && state.mode.tokensUsed, 300);
  assert.equal(state?.mode.kind === "auto" && state.mode.iteration, 3);
  assert.equal(state?.mode.kind === "auto" && state.mode.noProgressCount, 0);
});

test("reduceGoal: progress on a steer goal is ignored (no counters to grow)", () => {
  const state = reduceGoal([
    ev({ kind: "set", text: "A", at: 1, mode: steer() }),
    ev({ kind: "progress", at: 2, promptCost: 100, outputTokens: 5 }),
  ]);
  assert.deepEqual(state, { text: "A", status: "active", mode: steer() });
});

test("reduceGoal: resume re-activates and resets the runway (D3)", () => {
  const state = reduceGoal([
    ev({ kind: "set", text: "A", at: 1, mode: auto() }),
    ev({ kind: "progress", at: 2, promptCost: 500, outputTokens: 5 }),
    ev({ kind: "progress", at: 3, promptCost: 500, outputTokens: 5 }),
    ev({ kind: "status", at: 4, status: "paused", reason: "stuck" }),
    ev({ kind: "resume", at: 5 }),
  ]);
  assert.equal(state?.status, "active");
  assert.equal(state?.mode.kind === "auto" && state.mode.tokensUsed, 0);
  assert.equal(state?.mode.kind === "auto" && state.mode.iteration, 0);
  assert.equal(state?.mode.kind === "auto" && state.mode.noProgressCount, 0);
});

test("reduceGoal: a completed goal is not re-opened by pause or resume", () => {
  const completed: GoalEvent[] = [
    ev({ kind: "set", text: "A", at: 1, mode: auto() }),
    ev({ kind: "status", at: 2, status: "complete", reason: "model_complete" }),
  ];
  // resume must not re-activate a finished goal (would re-drive done work on a fresh budget)
  assert.equal(reduceGoal([...completed, ev({ kind: "resume", at: 3 })])?.status, "complete");
  // pause must not overwrite the terminal record
  assert.equal(reduceGoal([...completed, ev({ kind: "pause", at: 3 })])?.status, "complete");
});

test("reduceGoal: resume re-activates a blocked or budget_limited goal (fresh runway)", () => {
  for (const status of ["blocked", "budget_limited"] as const) {
    const state = reduceGoal([
      ev({ kind: "set", text: "A", at: 1, mode: auto({ tokensUsed: 500, iteration: 3 }) }),
      ev({ kind: "status", at: 2, status, reason: status === "blocked" ? "model_blocked" : "budget" }),
      ev({ kind: "resume", at: 3 }),
    ]);
    assert.equal(state?.status, "active");
    assert.equal(state?.mode.kind === "auto" && state.mode.tokensUsed, 0);
  }
});

test("reduceGoal: status event sets the lifecycle state", () => {
  const state = reduceGoal([
    ev({ kind: "set", text: "A", at: 1, mode: auto() }),
    ev({ kind: "status", at: 2, status: "complete", reason: "model_complete" }),
  ]);
  assert.equal(state?.status, "complete");
});

test("reduceGoal: clear removes the goal", () => {
  assert.equal(
    reduceGoal([ev({ kind: "set", text: "A", at: 1, mode: auto() }), ev({ kind: "clear", at: 2 })]),
    null,
  );
});

test("reduceGoal: edit/pause/resume/progress/status with no goal are no-ops", () => {
  assert.equal(reduceGoal([ev({ kind: "edit", text: "X", at: 1 })]), null);
  assert.equal(reduceGoal([ev({ kind: "pause", at: 1 })]), null);
  assert.equal(reduceGoal([ev({ kind: "resume", at: 1 })]), null);
  assert.equal(reduceGoal([ev({ kind: "progress", at: 1, promptCost: 1, outputTokens: 1 })]), null);
  assert.equal(reduceGoal([ev({ kind: "status", at: 1, status: "paused", reason: "stuck" })]), null);
});

test("reduceGoal: a branch slice (fork that saw fewer events) is consistent", () => {
  const events: GoalEvent[] = [
    ev({ kind: "set", text: "A", at: 1, mode: auto() }),
    ev({ kind: "edit", text: "A2", at: 2 }),
    ev({ kind: "clear", at: 3 }),
  ];
  assert.equal(reduceGoal(events.slice(0, 2))?.text, "A2");
  assert.equal(reduceGoal(events), null);
});

// ---------------------------------------------------------------------------
// Metering & error classification
// ---------------------------------------------------------------------------

const asst = (over: Partial<MessageLike> = {}): MessageLike => ({
  role: "assistant",
  usage: { input: 0, output: 0, cacheRead: 0 },
  stopReason: "stop",
  ...over,
});

test("computePromptCost: sums input + output across assistant messages (input is already net of cache)", () => {
  // pi reports usage.input already net of cacheRead, so cacheRead must NOT be subtracted
  // again (doing so collapses cost to ~0 in the cache-stable steady state).
  const msgs: MessageLike[] = [
    { role: "user" },
    asst({ usage: { input: 1000, output: 200, cacheRead: 900 } }), // 1000 + 200
    asst({ usage: { input: 500, output: 50, cacheRead: 500 } }), // 500 + 50
    { role: "toolResult" },
  ];
  assert.equal(computePromptCost(msgs), 1750);
});

test("computePromptCost: a heavily-cached turn still bills its fresh input (budget cannot be defeated)", () => {
  // The anchor is cache-stable so cacheRead >> input in steady state; fresh input must still count.
  assert.equal(computePromptCost([asst({ usage: { input: 2000, output: 300, cacheRead: 80000 } })]), 2300);
});

test("computeOutputTokens: sums assistant output only", () => {
  assert.equal(computeOutputTokens([asst({ usage: { input: 9, output: 30, cacheRead: 0 } }), asst({ usage: { input: 9, output: 12, cacheRead: 0 } })]), 42);
});

test("lastAssistantStopReason: returns the final assistant's stop reason", () => {
  assert.equal(lastAssistantStopReason([asst({ stopReason: "toolUse" }), asst({ stopReason: "aborted" })]), "aborted");
  assert.equal(lastAssistantStopReason([{ role: "user" }]), undefined);
});

test("classifyError: error vs transient vs none", () => {
  assert.equal(classifyError("stop", undefined), "none");
  assert.equal(classifyError("aborted", "user aborted"), "none");
  assert.equal(classifyError("error", "429 rate limit exceeded"), "retryable");
  assert.equal(classifyError("error", "upstream overloaded, try again"), "retryable");
  assert.equal(classifyError("error", "invalid API key"), "fatal");
  assert.equal(classifyError("error", undefined), "fatal");
});

// ---------------------------------------------------------------------------
// decideContinuation — full truth table + precedence
// ---------------------------------------------------------------------------

const okSignals = (over: Partial<ContinuationSignals> = {}): ContinuationSignals => ({
  aborted: false,
  humanTookOver: false,
  errorClass: "none",
  contextPercent: null,
  ...over,
});

test("decideContinuation: no goal stops", () => {
  assert.deepEqual(decideContinuation(null, okSignals()), { action: "stop", reason: "no_goal" });
});

test("decideContinuation: steer-only never drives", () => {
  const state: GoalState = { text: "A", status: "active", mode: steer() };
  assert.deepEqual(decideContinuation(state, okSignals()), { action: "stop", reason: "steer_only" });
});

test("decideContinuation: a non-active status stops (already terminal)", () => {
  const state: GoalState = { text: "A", status: "complete", mode: auto() };
  assert.deepEqual(decideContinuation(state, okSignals()), { action: "stop", reason: "already_terminal" });
});

test("decideContinuation: a clean active run continues", () => {
  const state: GoalState = { text: "A", status: "active", mode: auto({ iteration: 1, tokensUsed: 10 }) };
  assert.deepEqual(decideContinuation(state, okSignals()), { action: "continue", reason: "ok" });
});

test("decideContinuation: abort pauses (interrupted), never continues", () => {
  const state: GoalState = { text: "A", status: "active", mode: auto() };
  assert.deepEqual(decideContinuation(state, okSignals({ aborted: true })), {
    action: "pause",
    reason: "interrupted",
    mark: { status: "paused", reason: "interrupted" },
  });
});

test("decideContinuation: human takeover pauses", () => {
  const state: GoalState = { text: "A", status: "active", mode: auto() };
  assert.deepEqual(decideContinuation(state, okSignals({ humanTookOver: true })), {
    action: "pause",
    reason: "human_takeover",
    mark: { status: "paused", reason: "human_takeover" },
  });
});

test("decideContinuation: a fatal error pauses and marks blocked", () => {
  const state: GoalState = { text: "A", status: "active", mode: auto() };
  assert.deepEqual(decideContinuation(state, okSignals({ errorClass: "fatal" })), {
    action: "pause",
    reason: "error_fatal",
    mark: { status: "blocked", reason: "error_fatal" },
  });
});

test("decideContinuation: budget exhausted continues once and marks budget_limited", () => {
  const state: GoalState = { text: "A", status: "active", mode: auto({ tokensUsed: 1000, tokenBudget: 1000 }) };
  assert.deepEqual(decideContinuation(state, okSignals()), {
    action: "continue",
    reason: "budget_wrapup",
    mark: { status: "budget_limited", reason: "budget" },
  });
});

test("decideContinuation: no-progress streak pauses (stuck)", () => {
  const state: GoalState = { text: "A", status: "active", mode: auto({ noProgressCount: NO_PROGRESS_LIMIT }) };
  assert.deepEqual(decideContinuation(state, okSignals()), {
    action: "pause",
    reason: "stuck",
    mark: { status: "paused", reason: "stuck" },
  });
});

test("decideContinuation: max iterations pauses", () => {
  const state: GoalState = { text: "A", status: "active", mode: auto({ iteration: 5, maxIterations: 5 }) };
  assert.deepEqual(decideContinuation(state, okSignals()), {
    action: "pause",
    reason: "max_iterations",
    mark: { status: "paused", reason: "max_iterations" },
  });
});

test("decideContinuation: context full pauses", () => {
  const state: GoalState = { text: "A", status: "active", mode: auto() };
  assert.deepEqual(decideContinuation(state, okSignals({ contextPercent: 96 })), {
    action: "pause",
    reason: "context_full",
    mark: { status: "paused", reason: "context_full" },
  });
});

test("decideContinuation: a retryable error keeps the loop going (caps still apply)", () => {
  const state: GoalState = { text: "A", status: "active", mode: auto({ iteration: 1 }) };
  assert.deepEqual(decideContinuation(state, okSignals({ errorClass: "retryable" })), {
    action: "continue",
    reason: "retry",
  });
});

test("decideContinuation precedence: abort beats budget/stuck/max-iter", () => {
  const maxed: GoalState = {
    text: "A",
    status: "active",
    mode: auto({ tokensUsed: 9999, noProgressCount: 9, iteration: 99, maxIterations: 5 }),
  };
  assert.equal(decideContinuation(maxed, okSignals({ aborted: true })).action, "pause");
  assert.equal(decideContinuation(maxed, okSignals({ aborted: true })).reason, "interrupted");
});

test("decideContinuation precedence: a persistent retryable error cannot bypass the caps", () => {
  // The runaway risk: error precedence must NOT let an erroring run skip max-iter.
  const maxed: GoalState = { text: "A", status: "active", mode: auto({ iteration: 5, maxIterations: 5 }) };
  const d = decideContinuation(maxed, okSignals({ errorClass: "retryable" }));
  assert.equal(d.action, "pause");
  assert.equal(d.reason, "max_iterations");
});

// ---------------------------------------------------------------------------
// decideCompletion + summaryContradictsCompletion
// ---------------------------------------------------------------------------

test("summaryContradictsCompletion: catches admissions of unfinished work", () => {
  assert.equal(summaryContradictsCompletion("All requirements verified; tests green."), false);
  assert.equal(summaryContradictsCompletion("Implemented the feature and confirmed behaviour."), false);
  assert.equal(summaryContradictsCompletion("Mostly done but tests still failing"), true);
  assert.equal(summaryContradictsCompletion("Partially implemented the parser"), true);
  assert.equal(summaryContradictsCompletion("Done except a TODO in the handler"), true);
  assert.equal(summaryContradictsCompletion("Not yet complete"), true);
  assert.equal(summaryContradictsCompletion("There is remaining work on the API"), true);
});

test("summaryContradictsCompletion: negated success phrasing is NOT a contradiction", () => {
  assert.equal(summaryContradictsCompletion("All requirements satisfied; no remaining work."), false);
  assert.equal(summaryContradictsCompletion("Done. Nothing still needs doing."), false);
  assert.equal(summaryContradictsCompletion("Verified end to end; no outstanding tasks."), false);
});

test("summaryContradictsCompletion: marker words in the objective's own vocabulary are allowed", () => {
  // Goal is literally about a TODO list / partial streaming — naming the deliverable is fine.
  assert.equal(summaryContradictsCompletion("Implemented the TODO list feature; all tests pass.", "Add a TODO list feature"), false);
  assert.equal(summaryContradictsCompletion("Added partial response streaming; verified.", "Implement partial response streaming"), false);
  // ...but the same word is still a contradiction when it is NOT part of the objective.
  assert.equal(summaryContradictsCompletion("Shipped OAuth, though a TODO remains in the handler.", "Ship OAuth"), true);
});

test("decideCompletion: accepts a clean complete and emits a status event", () => {
  const state: GoalState = { text: "A", status: "active", mode: auto() };
  const r = decideCompletion(state, "complete", "Every requirement verified against current state.", 42);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.event, { kind: "status", at: 42, status: "complete", reason: "model_complete" });
});

test("decideCompletion: accepts blocked", () => {
  const state: GoalState = { text: "A", status: "active", mode: auto() };
  const r = decideCompletion(state, "blocked", "Impasse: needs a credential only the user has.", 7);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.event.kind === "status" && r.event.status, "blocked");
  assert.equal(r.event.kind === "status" && r.event.reason, "model_blocked");
});

test("decideCompletion: rejects a contradictory complete", () => {
  const state: GoalState = { text: "A", status: "active", mode: auto() };
  const r = decideCompletion(state, "complete", "Tests still failing but calling it done.", 1);
  assert.equal(r.ok, false);
});

test("decideCompletion: rejects when no goal / steer mode / already terminal", () => {
  assert.equal(decideCompletion(null, "complete", "x", 1).ok, false);
  assert.equal(decideCompletion({ text: "A", status: "active", mode: steer() }, "complete", "x", 1).ok, false);
  assert.equal(decideCompletion({ text: "A", status: "complete", mode: auto() }, "complete", "x", 1).ok, false);
});

// ---------------------------------------------------------------------------
// Renderers (byte stability; tail content)
// ---------------------------------------------------------------------------

test("renderGoalBlock: includes the objective and injection-hygiene framing (both modes)", () => {
  for (const mode of [steer(), auto()]) {
    const block = renderGoalBlock("Ship the OAuth refactor", mode);
    assert.match(block, /Ship the OAuth refactor/);
    assert.match(block, /user-provided data/);
    assert.match(block, /<active_goal>[\s\S]*<\/active_goal>/);
  }
});

test("renderGoalBlock: auto mode carries the completion/blocked audit; steer does not", () => {
  assert.match(renderGoalBlock("X", auto()), /Completion audit/);
  assert.match(renderGoalBlock("X", auto()), /Blocked audit/);
  assert.doesNotMatch(renderGoalBlock("X", steer()), /Completion audit/);
});

test("renderGoalBlock: byte-stable per (objective, mode kind) — no volatile counters", () => {
  // Two auto states with different counters render an identical anchor.
  const a = renderGoalBlock("Same", auto({ tokensUsed: 0, iteration: 0 }));
  const b = renderGoalBlock("Same", auto({ tokensUsed: 12345, iteration: 9 }));
  assert.equal(a, b);
  // Only the objective varies within a mode; the wrapper is identical.
  const wrapperA = renderGoalBlock("AAA", auto()).replace("AAA", "{o}");
  const wrapperB = renderGoalBlock("BBB", auto()).replace("BBB", "{o}");
  assert.equal(wrapperA, wrapperB);
});

test("renderGoalTail: active tail shows the budget countdown + update_goal nudge, never the objective", () => {
  const state: GoalState = { text: "MY-SECRET-OBJECTIVE", status: "active", mode: auto({ tokensUsed: 250, tokenBudget: 1000, iteration: 2 }) };
  const tail = renderGoalTail(state);
  assert.match(tail, /250 \/ 1000/);
  assert.match(tail, /update_goal/);
  assert.doesNotMatch(tail, /MY-SECRET-OBJECTIVE/);
});

test("renderGoalTail: budget_limited tail is the wrap-up message", () => {
  const state: GoalState = { text: "A", status: "budget_limited", mode: auto({ tokensUsed: 1000, tokenBudget: 1000 }) };
  const tail = renderGoalTail(state);
  assert.match(tail, /reached its token budget/);
  assert.match(tail, /[Ww]rap up/);
});

test("renderGoalTail: empty for steer / paused / terminal / no goal", () => {
  assert.equal(renderGoalTail(null), "");
  assert.equal(renderGoalTail({ text: "A", status: "active", mode: steer() }), "");
  assert.equal(renderGoalTail({ text: "A", status: "paused", mode: auto() }), "");
  assert.equal(renderGoalTail({ text: "A", status: "complete", mode: auto() }), "");
});

test("renderGoalStatus: reports text, status and mode/budget", () => {
  assert.match(renderGoalStatus(null), /No active goal/);
  const s = renderGoalStatus({ text: "A", status: "active", mode: auto({ tokensUsed: 5, tokenBudget: 1000 }) });
  assert.match(s, /Goal: A/);
  assert.match(s, /self-driving/);
  assert.match(s, /5 \/ 1000/);
});

test("CONTINUATION_KICK exists and reads as a continuation trigger", () => {
  assert.match(CONTINUATION_KICK, /[Cc]ontinue/);
});

// ---------------------------------------------------------------------------
// Property-based tests (zero-dep, seeded mulberry32; deterministic).
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomEventSequence(rand: () => number): GoalEvent[] {
  const n = Math.floor(rand() * 12);
  const events: GoalEvent[] = [];
  for (let i = 0; i < n; i++) {
    const roll = rand();
    if (roll < 0.18) events.push({ kind: "set", text: `g${i}`, at: i, mode: rand() < 0.7 ? auto() : steer() });
    else if (roll < 0.32) events.push({ kind: "edit", text: `e${i}`, at: i });
    else if (roll < 0.42) events.push({ kind: "pause", at: i });
    else if (roll < 0.52) events.push({ kind: "resume", at: i });
    else if (roll < 0.6) events.push({ kind: "clear", at: i });
    else if (roll < 0.82)
      events.push({ kind: "progress", at: i, promptCost: Math.floor(rand() * 500), outputTokens: Math.floor(rand() * 300) });
    else
      events.push({
        kind: "status",
        at: i,
        status: (["paused", "complete", "blocked", "budget_limited"] as const)[Math.floor(rand() * 4)],
        reason: "stuck",
      });
  }
  return events;
}

test("property: reduceGoal invariants over random event sequences", () => {
  const rand = mulberry32(0xC0FFEE);
  for (let iter = 0; iter < 2000; iter++) {
    const events = randomEventSequence(rand);
    const state = reduceGoal(events);

    // clear is final-until-set: if the last set/clear is a clear, state is null.
    let lastSetOrClear: GoalEvent | undefined;
    for (const e of events) if (e.kind === "set" || e.kind === "clear") lastSetOrClear = e;
    if (!lastSetOrClear || lastSetOrClear.kind === "clear") {
      assert.equal(state, null, `expected null state for ${JSON.stringify(events)}`);
      continue;
    }
    assert.ok(state, `expected a state for ${JSON.stringify(events)}`);

    // tokensUsed is monotonic non-decreasing across progress, and never negative.
    if (state.mode.kind === "auto") {
      assert.ok(state.mode.tokensUsed >= 0);
      assert.ok(state.mode.iteration >= 0);
      assert.ok(state.mode.noProgressCount >= 0);
    }

    // A steer goal never grows counters (its mode has none to grow).
    if (state.mode.kind === "steer") {
      assert.equal(Object.keys(state.mode).length, 1);
    }
  }
});

test("property: tokensUsed only ever increases as more progress events are folded", () => {
  const rand = mulberry32(0x1234);
  for (let iter = 0; iter < 500; iter++) {
    const events = randomEventSequence(rand);
    let prev = 0;
    let sawAuto = false;
    for (let i = 0; i < events.length; i++) {
      const state = reduceGoal(events.slice(0, i + 1));
      // Reset tracking whenever the goal is (re)set, resumed, or cleared.
      const last = events[i];
      if (last.kind === "set" || last.kind === "resume" || last.kind === "clear") {
        prev = state && state.mode.kind === "auto" ? state.mode.tokensUsed : 0;
        sawAuto = !!state && state.mode.kind === "auto";
        continue;
      }
      if (state && state.mode.kind === "auto") {
        if (sawAuto) assert.ok(state.mode.tokensUsed >= prev, "tokensUsed went down");
        prev = state.mode.tokensUsed;
        sawAuto = true;
      }
    }
  }
});

test("property: parseGoalOptions round-trip — text is the objective minus recognised flags", () => {
  const rand = mulberry32(0x5EED);
  const words = ["ship", "the", "oauth", "refactor", "fix", "bug", "now"];
  for (let iter = 0; iter < 500; iter++) {
    const objectiveWords: string[] = [];
    const parts: string[] = [];
    const count = 1 + Math.floor(rand() * 5);
    for (let i = 0; i < count; i++) {
      const w = words[Math.floor(rand() * words.length)];
      objectiveWords.push(w);
      parts.push(w);
      // Randomly sprinkle valid flags between objective words.
      if (rand() < 0.3) parts.push("--steer-only");
      if (rand() < 0.3) parts.push(`--tokens=${1 + Math.floor(rand() * 9)}k`);
      if (rand() < 0.3) parts.push(`--max-iter=${1 + Math.floor(rand() * 9)}`);
    }
    const r = parseGoalOptions(parts.join(" "));
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.text, objectiveWords.join(" "));
  }
});

test("property: decideContinuation always stops/pauses on terminal/abort/human regardless of caps", () => {
  const rand = mulberry32(0xABCD);
  for (let iter = 0; iter < 1000; iter++) {
    const mode = auto({
      tokensUsed: Math.floor(rand() * 4000),
      tokenBudget: 1000,
      iteration: Math.floor(rand() * 50),
      maxIterations: 5,
      noProgressCount: Math.floor(rand() * 10),
    });
    const state: GoalState = { text: "A", status: "active", mode };
    // Abort and human-takeover must never yield "continue".
    assert.notEqual(decideContinuation(state, okSignals({ aborted: true })).action, "continue");
    assert.notEqual(decideContinuation(state, okSignals({ humanTookOver: true })).action, "continue");
    // A fatal error must never continue.
    assert.notEqual(decideContinuation(state, okSignals({ errorClass: "fatal" })).action, "continue");
  }
});
