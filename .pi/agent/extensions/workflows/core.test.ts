import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { nextReplayKey, parseRunId, parseWorkflowInput, parseWorkflowName } from "./domain.ts";
import { firstHiddenControl, parseWorkflowScript } from "./parser.ts";
import { createWorkflowStore, workflowProjectKey } from "./store.ts";

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

test("parseWorkflowScript rejects common generated DSL shape mistakes", () => {
  const callbackPhase = parseWorkflowScript(`
export const meta = {};
const [a] = await phase("discover", () => parallel([]));
return a;
`);
  assert.equal(callbackPhase.ok, false);
  assert.match(callbackPhase.ok ? "" : callbackPhase.error.message, /phase\(title\) returns void/u);

  const objectAgent = parseWorkflowScript(`
export const meta = {};
const out = await agent({ name: "research", prompt: "inspect this" });
return out;
`);
  assert.equal(objectAgent.ok, false);
  assert.match(objectAgent.ok ? "" : objectAgent.error.message, /agent\(prompt, options\?\)/u);

  const eagerParallel = parseWorkflowScript(`
export const meta = {};
const out = await parallel([agent("inspect this")]);
return out;
`);
  assert.equal(eagerParallel.ok, false);
  assert.match(eagerParallel.ok ? "" : eagerParallel.error.message, /parallel\(\[\(\) => agent\(\.\.\.\)\]\)/u);
});

test("parseWorkflowScript accepts the canonical dynamic workflow skeleton", () => {
  const parsed = parseWorkflowScript(`
export const meta = { name: "demo", description: "demo workflow", phases: ["discover", "synthesise"] };

phase("discover");
const [a, b] = await parallel([
  () => agent("Prompt A", { label: "a" }),
  () => agent("Prompt B", { label: "b" }),
]);

phase("synthesise");
const result = await agent(\`Use these reports:\\n\${JSON.stringify({ a, b })}\`, { label: "synthesis" });

return { a, b, result };
`);
  assert.equal(parsed.ok, true);
});

test("parseWorkflowScript allows parallel function references when statically ambiguous", () => {
  const parsed = parseWorkflowScript(`
export const meta = {};
const task = () => agent("inspect this");
const out = await parallel([task]);
return out;
`);
  assert.equal(parsed.ok, true);
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

test("readJournal keeps valid entries when a trailing line is truncated", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-journal-"));
  const project = join(temp, "project");
  const root = join(temp, "root");
  const store = createWorkflowStore(project, root);

  const runId = parseRunId("wf_journal001");
  assert.equal(runId.ok, true);
  if (!runId.ok) return;

  await store.appendJournal(runId.value, {
    kind: "agent_started",
    at: 1,
    replayKey: "v2:abc" as never,
    index: 1,
    prompt: "hello",
  });

  // Simulate a crash mid-append: a truncated trailing JSON line.
  const journalFile = join(root, "projects", workflowProjectKey(project), "runs", runId.value, "journal.jsonl");
  await appendFile(journalFile, '{"kind":"agent_res', "utf8");

  const entries = await store.readJournal(runId.value);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "agent_started");
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
