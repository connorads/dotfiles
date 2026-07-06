import assert from "node:assert/strict";
import test from "node:test";

import { parseCommandRunId, parseRunCommand } from "./manager.ts";

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
