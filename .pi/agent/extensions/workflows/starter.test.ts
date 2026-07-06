import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWorkflowObjective,
  renderWorkflowStartPrompt,
  startWorkflowFromCommand,
  WORKFLOW_TOOL_NAME,
  type WorkflowStarterRuntime,
} from "./starter.ts";

test("parseWorkflowObjective trims input and rejects empty or hidden-control objectives", () => {
  const parsed = parseWorkflowObjective("  review the extension  ");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value, "review the extension");

  assert.equal(parseWorkflowObjective("").ok, false);
  assert.equal(parseWorkflowObjective("bad\u0000objective").ok, false);
});

test("renderWorkflowStartPrompt asks the model to call workflow with an inline script", () => {
  const objective = parseWorkflowObjective("review architecture and tests");
  assert.equal(objective.ok, true);
  if (!objective.ok) return;

  const prompt = renderWorkflowStartPrompt(objective.value);
  assert.match(prompt, /call the `workflow` tool exactly once/u);
  assert.match(prompt, /Use the tool's `script` input/u);
  assert.match(prompt, /Do not use `name` or `scriptPath`/u);
  assert.match(prompt, /export const meta/u);
  assert.match(prompt, /`phase\(title\)` returns void/u);
  assert.match(prompt, /agent\(prompt, options\?\)/u);
  assert.match(prompt, /parallel\(\[\(\) => agent\(\.\.\.\)\]\)/u);
  assert.match(prompt, /Never write `phase\("discover", \(\) => parallel\(\.\.\.\)\)`/u);
  assert.match(prompt, /Never write `agent\(\{ name, prompt \}\)`/u);
  assert.match(prompt, /const \[a, b\] = await parallel/u);
  assert.match(prompt, /review architecture and tests/u);
});

test("startWorkflowFromCommand activates workflow and sends one follow-up", () => {
  const runtime = new FakeStarterRuntime();
  const started = startWorkflowFromCommand("review architecture", runtime);

  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.deepEqual(runtime.activated, [WORKFLOW_TOOL_NAME]);
  assert.equal(runtime.followUps.length, 1);
  assert.equal(runtime.followUps[0], started.value.prompt);
  assert.match(started.value.summary, /Workflow starter sent/u);
});

test("startWorkflowFromCommand does not send anything for invalid objectives", () => {
  const runtime = new FakeStarterRuntime();
  const started = startWorkflowFromCommand("   ", runtime);

  assert.equal(started.ok, false);
  assert.deepEqual(runtime.activated, []);
  assert.deepEqual(runtime.followUps, []);
});

class FakeStarterRuntime implements WorkflowStarterRuntime {
  readonly activated: string[] = [];
  readonly followUps: string[] = [];

  activateTool(name: string): void {
    this.activated.push(name);
  }

  sendFollowUp(message: string): void {
    this.followUps.push(message);
  }
}
