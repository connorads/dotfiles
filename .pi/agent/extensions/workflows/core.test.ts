import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { nextReplayKey, parseWorkflowInput, parseWorkflowName } from "./domain.ts";
import { firstHiddenControl, parseWorkflowScript } from "./parser.ts";
import { createWorkflowStore } from "./store.ts";

test("parseWorkflowInput accepts exactly one source and JSON args", () => {
  const parsed = parseWorkflowInput({ name: "review.js", args: { depth: 2, tags: ["plan"] } });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.source.kind, "name");
  assert.equal(parsed.value.source.kind === "name" && parsed.value.source.name, "review");
  assert.deepEqual(parsed.value.args, { depth: 2, tags: ["plan"] });
});

test("parseWorkflowInput rejects unknown keys, multiple sources, and non-JSON args", () => {
  assert.equal(parseWorkflowInput({ name: "a", extra: true }).ok, false);
  assert.equal(parseWorkflowInput({ name: "a", script: "export const meta = {}" }).ok, false);
  assert.equal(parseWorkflowInput({ name: "a", args: { nope: undefined } }).ok, false);
  assert.equal(parseWorkflowInput({ name: "../escape" }).ok, false);
});

test("parseWorkflowScript extracts pure metadata and executable body", () => {
  const parsed = parseWorkflowScript(`
export const meta = { name: "demo", description: \`docs\`, phases: ["Plan"], budget: 100 };
phase("Plan");
return args;
`);

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.meta.name, "demo");
  assert.equal(parsed.value.meta.description, "docs");
  assert.deepEqual(parsed.value.meta.phases, ["Plan"]);
  assert.equal(parsed.value.meta.budget, 100);
  assert.match(parsed.value.body, /^phase\("Plan"\);/u);
});

test("parseWorkflowScript rejects executable metadata and dangerous static runtime calls", () => {
  const badMeta = parseWorkflowScript("export const meta = { name: process.env.X };\nreturn null;");
  assert.equal(badMeta.ok, false);
  assert.match(badMeta.ok ? "" : badMeta.error.message, /executable expression/u);

  const proto = parseWorkflowScript("export const meta = { __proto__: { polluted: true } };\nreturn null;");
  assert.equal(proto.ok, false);
  assert.match(proto.ok ? "" : proto.error.message, /not allowed/u);

  for (const body of ["Date.now();", "Math.random();", "new Date();"]) {
    const parsed = parseWorkflowScript(`export const meta = {};\n${body}\nreturn null;`);
    assert.equal(parsed.ok, false, body);
  }
});

test("firstHiddenControl reports hidden controls", () => {
  assert.equal(firstHiddenControl("ok\n\t"), undefined);
  assert.equal(firstHiddenControl("bad\u0000"), 0);
});

test("nextReplayKey is stable for semantically equal options and chained by previous call", () => {
  const first = nextReplayKey("", "prompt", { model: "m", schema: { b: 2, a: 1 } });
  const same = nextReplayKey("", "prompt", { schema: { a: 1, b: 2 }, model: "m" });
  const chained = nextReplayKey(first, "prompt", { model: "m", schema: { a: 1, b: 2 } });

  assert.equal(first, same);
  assert.notEqual(first, chained);
});

test("store resolves named workflows only from Pi project/user script roots", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-core-"));
  const project = join(temp, "project");
  const root = join(temp, "workflow-root");
  const projectScripts = join(project, ".pi", "workflows");
  const legacyScripts = join(root, "projects", "old");
  await mkdir(projectScripts, { recursive: true });
  await mkdir(legacyScripts, { recursive: true });

  const script = "export const meta = { name: \"named\" };\nreturn null;\n";
  await writeFile(join(projectScripts, "named.js"), script, "utf8");
  await writeFile(join(legacyScripts, "legacy.js"), script, "utf8");

  const store = createWorkflowStore(project, root);
  assert.deepEqual(await store.listWorkflowNames(), ["named"]);

  const name = parseWorkflowName("named");
  assert.equal(name.ok, true);
  if (!name.ok) return;

  const resolved = await store.resolveSource({ kind: "name", name: name.value });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.value.source, script);
  assert.equal(resolved.value.displayName, "named");
  assert.equal(resolved.value.scriptPath, join(projectScripts, "named.js"));
});
