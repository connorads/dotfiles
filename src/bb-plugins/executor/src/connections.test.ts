import assert from "node:assert/strict";
import { test } from "node:test";
import { ownerOf, parseConnectionUrl, resolveChoice, resolveHierarchy, slugFor } from "./connections.ts";
import { parseVault, vaultSettingSchema } from "./credentials.ts";
import { bbToolName } from "./tools.ts";

test("keeps only the connection parameter of a Connect page URL", () => {
  const result = parseConnectionUrl(" https://mcp.executor.sh/mcp?elicitation_mode=model&connection=c_1#x ");
  assert.ok(result.ok);
  assert.equal(result.url.href, "https://mcp.executor.sh/mcp?connection=c_1");
});

test("accepts organization URLs and plain /mcp", () => {
  assert.ok(parseConnectionUrl("https://mcp.executor.sh/org/acme/mcp").ok);
  assert.ok(parseConnectionUrl("https://mcp.executor.sh/mcp").ok);
});

test("refuses non-Executor paths, plain http and other approval modes", () => {
  assert.ok(!parseConnectionUrl("https://mcp.executor.sh/api").ok);
  assert.ok(!parseConnectionUrl("http://mcp.executor.sh/mcp").ok);
  assert.ok(parseConnectionUrl("http://127.0.0.1:4312/mcp").ok);
  assert.ok(!parseConnectionUrl("https://mcp.executor.sh/mcp?elicitation_mode=native").ok);
  assert.ok(!parseConnectionUrl("not a url").ok);
});

test("slugs are unique", () => {
  assert.equal(slugFor("Personal Ops!", new Set()), "personal-ops");
  assert.equal(slugFor("Ops", new Set(["ops"])), "ops-2");
  assert.equal(slugFor("!!!", new Set()), "connection");
});

test("a thread falls back to the default when its connection is gone", () => {
  const connections = [{ id: "a", name: "A", url: "https://x/mcp" }];
  assert.deepEqual(resolveChoice({ kind: "connection", id: "gone" }, "a", connections), { kind: "connection", connection: connections[0] });
  assert.deepEqual(resolveChoice({ kind: "default" }, null, connections), { kind: "unset" });
  assert.deepEqual(resolveChoice({ kind: "off" }, "a", connections), { kind: "off" });
});

test("the vault setting rejects hand edits that would corrupt it", () => {
  assert.ok(vaultSettingSchema.safeParse("").success);
  assert.ok(vaultSettingSchema.safeParse(JSON.stringify({ clients: {}, grants: {} })).success);
  assert.ok(!vaultSettingSchema.safeParse("oops").success);
  assert.equal(parseVault("{\"clients\":1}"), null);
});

test("tool names fit provider rules", () => {
  assert.equal(bbToolName("execute"), "executor_execute");
  assert.equal(bbToolName("a.b c"), "executor_a_b_c");
  assert.equal(bbToolName("x".repeat(100)).length, 64);
});


test("keeps browser delivery and scope, rejects unsupported modes", () => {
  const browser = parseConnectionUrl("https://executor.test/mcp?tracking=drop&elicitation_mode=browser&connection=c_1#fragment");
  assert.ok(browser.ok);
  assert.equal(browser.url.href, "https://executor.test/mcp?connection=c_1&elicitation_mode=browser");
  assert.ok(!parseConnectionUrl("https://executor.test/mcp?elicitation_mode=native").ok);
  assert.ok(!parseConnectionUrl("https://executor.test/mcp?elicitation_mode=typo").ok);
});

test("resolveHierarchy follows thread → owner → project → global default", () => {
  const connections = [
    { id: "rex", name: "Rex", url: "https://x/mcp?connection=rex" },
    { id: "klimble", name: "Klimble", url: "https://x/mcp?connection=klimble" },
    { id: "cf", name: "Cloudflare", url: "https://x/mcp?connection=cf" },
  ];
  const base = {
    thread: { kind: "default" as const },
    owner: null,
    project: { kind: "connection" as const, id: "klimble" },
    globalDefault: { kind: "connection" as const, id: "rex" },
    connections,
  };
  assert.deepEqual(resolveHierarchy(base), { kind: "connection", connection: connections[1], source: "project" });
  assert.deepEqual(resolveHierarchy({ ...base, project: { kind: "off" } }), { kind: "off", source: "project" });
  assert.deepEqual(resolveHierarchy({ ...base, project: null }), { kind: "connection", connection: connections[0], source: "default" });
  assert.deepEqual(resolveHierarchy({ ...base, project: null, globalDefault: { kind: "off" } }), { kind: "off", source: "default" });
  assert.deepEqual(resolveHierarchy({ ...base, owner: { kind: "connection", connection: connections[2]!, source: "thread" } }), {
    kind: "connection", connection: connections[2], source: "owner",
  });
  assert.deepEqual(resolveHierarchy({ ...base, owner: { kind: "off", source: "thread" } }), { kind: "off", source: "owner" });
  assert.deepEqual(resolveHierarchy({ ...base, thread: { kind: "connection", id: "rex" }, owner: { kind: "off", source: "thread" } }), {
    kind: "connection", connection: connections[0], source: "thread",
  });
});

test("ownerOf finds parent threads and BB workflow origin threads", () => {
  assert.equal(ownerOf({ parentThreadId: "thr_parent", originPluginId: null, lifecycleOwnerThreadId: null }), "thr_parent");
  assert.equal(ownerOf({ parentThreadId: null, originPluginId: "workflows", lifecycleOwnerThreadId: "thr_origin" }), "thr_origin");
  assert.equal(ownerOf({ parentThreadId: null, originPluginId: "other", lifecycleOwnerThreadId: "thr_origin" }), null);
});
