import assert from "node:assert/strict";
import test from "node:test";

import { createWorkflowStart } from "./starter.ts";

test("createWorkflowStart trims objectives and rejects empty or hidden-control objectives", () => {
  const parsed = createWorkflowStart("  review the extension  ");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.objective, "review the extension");

  assert.equal(createWorkflowStart("").ok, false);
  assert.equal(createWorkflowStart("bad\u0000objective").ok, false);
});

test("createWorkflowStart prompt asks the model to call workflow with an inline script", () => {
  const started = createWorkflowStart("review architecture and tests");
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const prompt = started.value.prompt;
  assert.match(prompt, /call the `workflow` tool exactly once/u);
  assert.match(prompt, /first action in this turn must be a `workflow` tool call/u);
  assert.match(prompt, /Use the tool's `script` input/u);
  assert.match(prompt, /Do not use `name` or `scriptPath`/u);
  assert.match(prompt, /Do not call `read`, `grep`, `find`, `ls`, `bash`/u);
  assert.match(prompt, /Do not call any tool except `workflow`/u);
  assert.match(prompt, /export const meta/u);
  assert.match(prompt, /`phase\(title\)` returns void/u);
  assert.match(prompt, /agent\(prompt, options\?\)/u);
  assert.match(prompt, /parallel\(\[\(\) => agent\(\.\.\.\)\]\)/u);
  assert.match(prompt, /Never write `phase\("discover", \(\) => parallel\(\.\.\.\)\)`/u);
  assert.match(prompt, /Never write `agent\(\{ name, prompt \}\)`/u);
  assert.match(prompt, /const \[a, b\] = await parallel/u);
  assert.match(prompt, /review architecture and tests/u);
  assert.match(prompt, /Date\.now/u);
  assert.match(prompt, /Math\.random/u);
  assert.match(prompt, /import\/export/u);
  assert.match(prompt, /busy-loop/u);
  assert.match(prompt, /Omit `meta\.budget` unless the user explicitly asks/u);
  assert.match(prompt, /effort/u);
});

test("createWorkflowStart returns a prompt without Pi side effects", () => {
  const started = createWorkflowStart("review architecture");

  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.match(started.value.summary, /Workflow starter sent/u);
  assert.match(started.value.prompt, /review architecture/u);
});

test("createWorkflowStart rejects invalid objectives", () => {
  const started = createWorkflowStart("   ");

  assert.equal(started.ok, false);
});
