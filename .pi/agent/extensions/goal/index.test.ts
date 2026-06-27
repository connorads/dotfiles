import test from "node:test";
import assert from "node:assert/strict";

import goalExtension from "./index.ts";
import { GOAL_ENTRY_TYPE, type GoalEvent } from "./core.ts";

// Minimal in-memory fake of the slice of pi the extension uses. Not a mock:
// appendEntry really appends, getBranch really reflects it, so the shell exercises
// its actual read-fold-inject path.
function harness(seed: GoalEvent[] = []) {
  const entries = seed.map((data) => ({ type: "custom" as const, customType: GOAL_ENTRY_TYPE, data }));
  let widget: string[] | undefined;
  const notes: string[] = [];
  let editorReply: string | undefined;

  const ctx = {
    hasUI: true,
    sessionManager: { getBranch: () => entries.slice() },
    ui: {
      setWidget: (_key: string, content: string[] | undefined) => {
        widget = content;
      },
      notify: (message: string) => notes.push(message),
      editor: async (_title: string, _prefill?: string) => editorReply,
    },
  };

  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  let command: ((args: string, ctx: unknown) => Promise<void>) | undefined;

  const pi = {
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(event, handler),
    registerCommand: (_name: string, opts: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
      command = opts.handler;
    },
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom" as const, customType: customType as typeof GOAL_ENTRY_TYPE, data: data as GoalEvent }),
  };

  // pi is a deliberate in-memory test double for the slice the extension uses.
  goalExtension(pi as unknown as Parameters<typeof goalExtension>[0]);

  return {
    get widget() {
      return widget;
    },
    notes,
    setEditorReply: (value: string | undefined) => {
      editorReply = value;
    },
    fire: (event: string, payload: unknown = {}) => handlers.get(event)?.(payload, ctx),
    run: (args: string) => command!(args, ctx),
    inject: () =>
      handlers.get("before_agent_start")!({ systemPrompt: "BASE" }, ctx) as
        | { systemPrompt: string }
        | undefined,
  };
}

test("set: persists, shows a widget, and injects the objective into the system prompt", async () => {
  const h = harness();
  await h.run("Ship the OAuth refactor");
  assert.deepEqual(h.widget, ["◆ goal: Ship the OAuth refactor"]);
  const result = h.inject();
  assert.match(result!.systemPrompt, /^BASE/);
  assert.match(result!.systemPrompt, /Ship the OAuth refactor/);
  assert.match(result!.systemPrompt, /<active_goal>/);
});

test("pause stops injection; resume restores it", async () => {
  const h = harness();
  await h.run("Do the thing");
  await h.run("pause");
  assert.equal(h.inject(), undefined);
  assert.deepEqual(h.widget, ["◆ goal: Do the thing  (paused)"]);
  await h.run("resume");
  assert.match(h.inject()!.systemPrompt, /Do the thing/);
});

test("clear removes the anchor and the widget", async () => {
  const h = harness();
  await h.run("Do the thing");
  await h.run("clear");
  assert.equal(h.inject(), undefined);
  assert.equal(h.widget, undefined);
});

test("edit replaces the injected objective", async () => {
  const h = harness();
  await h.run("Old objective");
  h.setEditorReply("New objective");
  await h.run("edit");
  assert.match(h.inject()!.systemPrompt, /New objective/);
  assert.doesNotMatch(h.inject()!.systemPrompt, /Old objective/);
});

test("bare /goal reports state without injecting anything", async () => {
  const h = harness();
  await h.run("");
  assert.deepEqual(h.notes, ["No active goal. Set one with /goal <objective>."]);
  await h.run("Some goal");
  await h.run("");
  assert.equal(h.notes.at(-1), "Goal: Some goal");
});

test("reconstruction: a pre-existing goal on the branch is restored on session_start", () => {
  // simulates /resume or /fork landing on a branch that already carries a goal
  const h = harness([{ kind: "set", text: "Inherited goal", at: 1 }]);
  h.fire("session_start");
  assert.deepEqual(h.widget, ["◆ goal: Inherited goal"]);
  assert.match(h.inject()!.systemPrompt, /Inherited goal/);
});

test("compaction-proof: the anchor depends only on the goal entry, not chat history", async () => {
  // The injection reads goal events from the branch, independent of how much
  // conversation has been summarised away — so a compaction can never drop it.
  const h = harness();
  await h.run("Persistent objective");
  // many turns later, after a hypothetical compaction, the same branch is queried:
  assert.match(h.inject()!.systemPrompt, /Persistent objective/);
});
