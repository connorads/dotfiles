import test from "node:test";
import assert from "node:assert/strict";

import { type GoalMode, type GoalState } from "./core.ts";
import {
  CONTINUATION_KICK,
  renderGoalBlock,
  renderGoalStatus,
  renderGoalTail,
} from "./prompts.ts";

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
