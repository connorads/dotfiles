import test from "node:test";
import assert from "node:assert/strict";

import {
  type GoalEvent,
  parseGoalCommand,
  reduceGoal,
  renderGoalBlock,
} from "./core.ts";

test("parseGoalCommand: bare and whitespace-only args show", () => {
  assert.deepEqual(parseGoalCommand(""), { kind: "show" });
  assert.deepEqual(parseGoalCommand("   "), { kind: "show" });
});

test("parseGoalCommand: reserved words are subcommands only when alone", () => {
  assert.deepEqual(parseGoalCommand("edit"), { kind: "edit" });
  assert.deepEqual(parseGoalCommand("pause"), { kind: "pause" });
  assert.deepEqual(parseGoalCommand("resume"), { kind: "resume" });
  assert.deepEqual(parseGoalCommand("clear"), { kind: "clear" });
  // case-insensitive, surrounding whitespace ignored
  assert.deepEqual(parseGoalCommand("  PAUSE "), { kind: "pause" });
});

test("parseGoalCommand: a reserved word with trailing text sets a goal", () => {
  assert.deepEqual(parseGoalCommand("pause the build"), {
    kind: "set",
    text: "pause the build",
  });
});

test("parseGoalCommand: set preserves the objective text verbatim (trimmed)", () => {
  assert.deepEqual(parseGoalCommand("  Ship the OAuth refactor  "), {
    kind: "set",
    text: "Ship the OAuth refactor",
  });
});

const ev = (e: GoalEvent): GoalEvent => e;

test("reduceGoal: no events means no goal", () => {
  assert.equal(reduceGoal([]), null);
});

test("reduceGoal: set establishes an active goal", () => {
  assert.deepEqual(reduceGoal([ev({ kind: "set", text: "A", at: 1 })]), {
    text: "A",
    status: "active",
  });
});

test("reduceGoal: latest set wins", () => {
  assert.deepEqual(
    reduceGoal([
      ev({ kind: "set", text: "A", at: 1 }),
      ev({ kind: "set", text: "B", at: 2 }),
    ]),
    { text: "B", status: "active" },
  );
});

test("reduceGoal: edit changes text and preserves status", () => {
  assert.deepEqual(
    reduceGoal([
      ev({ kind: "set", text: "A", at: 1 }),
      ev({ kind: "pause", at: 2 }),
      ev({ kind: "edit", text: "A2", at: 3 }),
    ]),
    { text: "A2", status: "paused" },
  );
});

test("reduceGoal: pause then resume toggles status, keeping text", () => {
  assert.deepEqual(
    reduceGoal([
      ev({ kind: "set", text: "A", at: 1 }),
      ev({ kind: "pause", at: 2 }),
      ev({ kind: "resume", at: 3 }),
    ]),
    { text: "A", status: "active" },
  );
});

test("reduceGoal: clear removes the goal", () => {
  assert.equal(
    reduceGoal([
      ev({ kind: "set", text: "A", at: 1 }),
      ev({ kind: "clear", at: 2 }),
    ]),
    null,
  );
});

test("reduceGoal: edit/pause/resume with no goal are no-ops", () => {
  assert.equal(reduceGoal([ev({ kind: "edit", text: "X", at: 1 })]), null);
  assert.equal(reduceGoal([ev({ kind: "pause", at: 1 })]), null);
  assert.equal(reduceGoal([ev({ kind: "resume", at: 1 })]), null);
});

test("reduceGoal: a branch slice (fork that saw fewer events) is consistent", () => {
  const events: GoalEvent[] = [
    ev({ kind: "set", text: "A", at: 1 }),
    ev({ kind: "edit", text: "A2", at: 2 }),
    ev({ kind: "clear", at: 3 }),
  ];
  // a branch forked before the clear still has its goal
  assert.deepEqual(reduceGoal(events.slice(0, 2)), {
    text: "A2",
    status: "active",
  });
  // the branch that saw the clear does not
  assert.equal(reduceGoal(events), null);
});

test("renderGoalBlock: includes the objective and the injection-hygiene framing", () => {
  const block = renderGoalBlock("Ship the OAuth refactor");
  assert.match(block, /Ship the OAuth refactor/);
  assert.match(block, /user-provided data/);
  assert.match(block, /<active_goal>[\s\S]*<\/active_goal>/);
});

test("renderGoalBlock: is deterministic for a given objective", () => {
  assert.equal(renderGoalBlock("Same objective"), renderGoalBlock("Same objective"));
});

test("renderGoalBlock: only the objective varies — the wrapper is byte-stable (cache-safe)", () => {
  // Blank out the objective in each render; everything else must be identical,
  // proving the cached system prompt changes only when the objective changes.
  const wrapperA = renderGoalBlock("AAA").replace("AAA", "{objective}");
  const wrapperB = renderGoalBlock("BBB").replace("BBB", "{objective}");
  assert.equal(wrapperA, wrapperB);
});
