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

  assert.equal(parsed.value.source?.kind, "name");
  assert.equal(parsed.value.source?.kind === "name" && parsed.value.source.name, "review");
  assert.deepEqual(parsed.value.args, { depth: 2, tags: ["plan"] });
});

test("parseWorkflowInput rejects unknown keys, multiple sources, and non-JSON args", () => {
  assert.equal(parseWorkflowInput({ name: "a", extra: true }).ok, false);
  assert.equal(parseWorkflowInput({ name: "a", script: "export const meta = {}" }).ok, false);
  assert.equal(parseWorkflowInput({ name: "a", args: { nope: undefined } }).ok, false);
  assert.equal(parseWorkflowInput({ name: "../escape" }).ok, false);
});

test("parseWorkflowInput accepts a bare resumeFromRunId with no source", () => {
  const bare = parseWorkflowInput({ resumeFromRunId: "wf_abcdef01" });
  assert.equal(bare.ok, true);
  if (!bare.ok) return;
  assert.equal(bare.value.source, undefined);
  assert.equal(bare.value.resumeFromRunId, "wf_abcdef01");

  assert.equal(parseWorkflowInput({}).ok, false);
  assert.equal(
    parseWorkflowInput({ script: "x", name: "y", resumeFromRunId: "wf_abcdef01" }).ok,
    false,
  );
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

test("parseWorkflowScript accepts Claude-style object phases and filters invalid entries", () => {
  const parsed = parseWorkflowScript(`
export const meta = {
  name: "demo",
  description: "docs",
  phases: [{ title: "Scan", detail: "grep logs" }, "Fix", { detail: "no title" }, 7, { title: "Verify" }],
};
return null;
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.meta.phases, ["Scan", "Fix", "Verify"]);
});

test("parseWorkflowScript requires non-empty meta.name and meta.description", () => {
  const missingName = parseWorkflowScript(`export const meta = { description: "d" };\nreturn null;`);
  assert.equal(missingName.ok, false);
  assert.match(missingName.ok ? "" : missingName.error.message, /meta\.name/u);

  const missingDescription = parseWorkflowScript(`export const meta = { name: "n" };\nreturn null;`);
  assert.equal(missingDescription.ok, false);
  assert.match(missingDescription.ok ? "" : missingDescription.error.message, /meta\.description/u);

  const emptyName = parseWorkflowScript(`export const meta = { name: "", description: "d" };\nreturn null;`);
  assert.equal(emptyName.ok, false);
});

test("parseWorkflowScript rejects regex literals in meta instead of coercing them", () => {
  const parsed = parseWorkflowScript(`export const meta = { name: "n", description: /d/ };\nreturn null;`);
  assert.equal(parsed.ok, false);
  assert.match(parsed.ok ? "" : parsed.error.message, /regex/iu);
});

test("parseWorkflowScript rejects executable metadata and dangerous static runtime calls", () => {
  const badMeta = parseWorkflowScript("export const meta = { name: process.env.X };\nreturn null;");
  assert.equal(badMeta.ok, false);
  assert.match(badMeta.ok ? "" : badMeta.error.message, /executable expression/u);

  const proto = parseWorkflowScript("export const meta = { __proto__: { polluted: true } };\nreturn null;");
  assert.equal(proto.ok, false);
  assert.match(proto.ok ? "" : proto.error.message, /not allowed/u);

  for (const body of ["Date.now();", "Math.random();", "new Date();"]) {
    const parsed = parseWorkflowScript(`export const meta = { name: "t", description: "t" };\n${body}\nreturn null;`);
    assert.equal(parsed.ok, false, body);
  }
});

test("parseWorkflowScript rejects common generated DSL shape mistakes", () => {
  const callbackPhase = parseWorkflowScript(`
export const meta = { name: "t", description: "t" };
const [a] = await phase("discover", () => parallel([]));
return a;
`);
  assert.equal(callbackPhase.ok, false);
  assert.match(callbackPhase.ok ? "" : callbackPhase.error.message, /phase\(title\) returns void/u);

  const objectAgent = parseWorkflowScript(`
export const meta = { name: "t", description: "t" };
const out = await agent({ name: "research", prompt: "inspect this" });
return out;
`);
  assert.equal(objectAgent.ok, false);
  assert.match(objectAgent.ok ? "" : objectAgent.error.message, /agent\(prompt, options\?\)/u);

  const eagerParallel = parseWorkflowScript(`
export const meta = { name: "t", description: "t" };
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
export const meta = { name: "t", description: "t" };
const task = () => agent("inspect this");
const out = await parallel([task]);
return out;
`);
  assert.equal(parsed.ok, true);
});

test("firstHiddenControl reports hidden controls and Unicode invisibles", () => {
  assert.equal(firstHiddenControl("ok\n\t"), undefined);
  assert.equal(firstHiddenControl("bad\u0000"), 0);
  assert.equal(firstHiddenControl("bom\ufeff"), 0xfeff);
  assert.equal(firstHiddenControl("zwsp\u200b"), 0x200b);
  assert.equal(firstHiddenControl("rlo\u202e"), 0x202e);
  assert.equal(firstHiddenControl("ls\u2028"), 0x2028);
  assert.equal(firstHiddenControl("wj\u2060"), 0x2060);
});

test("parseWorkflowScript reports CRLF sources with a conversion hint", () => {
  const crlf = parseWorkflowScript(`export const meta = { name: "t", description: "t" };\r\nreturn null;`);
  assert.equal(crlf.ok, false);
  assert.match(crlf.ok ? "" : crlf.error.message, /CRLF line endings are not supported - convert the script to LF/u);

  const zwsp = parseWorkflowScript(`export const meta = { name: "t", description: "t" };\nreturn\u200b null;`);
  assert.equal(zwsp.ok, false);
  assert.match(zwsp.ok ? "" : zwsp.error.message, /hidden control character 0x200b/u);
});

test("nextReplayKey is stable for semantically equal options and chained by previous call", () => {
  const first = nextReplayKey("", "prompt", { model: "m", schema: { b: 2, a: 1 } });
  const same = nextReplayKey("", "prompt", { schema: { a: 1, b: 2 }, model: "m" });
  const chained = nextReplayKey(first, "prompt", { model: "m", schema: { a: 1, b: 2 } });

  assert.equal(first, same);
  assert.notEqual(first, chained);
});

test("nextReplayKey v3 hashes fields separately so NUL in prompts cannot cross boundaries", () => {
  assert.match(nextReplayKey("", "p", {}), /^v3:[0-9a-f]{64}$/u);

  // Shifting content across the prompt/options boundary must change the key.
  const nulInPrompt = nextReplayKey("", 'p\u0000{"schema":"x"}', {});
  const inOptions = nextReplayKey("", "p", { schema: "x" });
  assert.notEqual(nulInPrompt, inOptions);

  // Shifting content across the previous/prompt boundary must change the key.
  const previous = nextReplayKey("", "seed", {});
  const chained = nextReplayKey(previous, "p", {});
  const glued = nextReplayKey("", `${previous}\u0000p`, {});
  assert.notEqual(chained, glued);
});

test("readRun rejects a non-finite budgetTotal", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-budget-"));
  const project = join(temp, "project");
  const root = join(temp, "root");
  const store = createWorkflowStore(project, root);
  const runId = parseRunId("wf_budget001");
  assert.equal(runId.ok, true);
  if (!runId.ok) return;

  const dir = join(root, "projects", workflowProjectKey(project), "runs", runId.value);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "run.json"),
    `{"schemaVersion":1,"runId":"${runId.value}","status":"completed","budgetTotal":1e999,"startedAt":1,"updatedAt":1}`,
    "utf8",
  );
  const run = await store.readRun(runId.value);
  assert.equal(run.ok, true);
  if (!run.ok) return;
  assert.equal(run.value.budgetTotal, null);
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

test("appendJournal survives a torn trailing fragment without a newline", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-workflows-torn-"));
  const project = join(temp, "project");
  const root = join(temp, "root");
  const store = createWorkflowStore(project, root);

  const runId = parseRunId("wf_torn00001");
  assert.equal(runId.ok, true);
  if (!runId.ok) return;

  // A crash mid-append can leave a fragment with no trailing newline; the next
  // append must not glue onto it and corrupt both entries.
  const journalFile = join(root, "projects", workflowProjectKey(project), "runs", runId.value, "journal.jsonl");
  await mkdir(join(root, "projects", workflowProjectKey(project), "runs", runId.value), { recursive: true });
  await writeFile(journalFile, '{"kind":"agent_res', "utf8");

  await store.appendJournal(runId.value, {
    kind: "agent_started",
    at: 1,
    replayKey: "v3:abc" as never,
    index: 1,
    prompt: "hello",
  });

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
