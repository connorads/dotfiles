import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConnectionUrl, resolveChoice, slugFor } from "./connections.ts";
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
