import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "./config.ts";
import { bbToolName } from "./tools.ts";

test("accepts an https endpoint and a key", () => {
  const result = parseConfig({ url: " https://mcp.executor.sh/org/me/mcp ", token: " exp_1 " });
  assert.ok(result.ok);
  assert.equal(result.config.url.href, "https://mcp.executor.sh/org/me/mcp");
  assert.equal(result.config.token, "exp_1");
});

test("allows plain http only on loopback", () => {
  assert.ok(parseConfig({ url: "http://127.0.0.1:4312/mcp", token: "k" }).ok);
  assert.ok(!parseConfig({ url: "http://executor.example/mcp", token: "k" }).ok);
});

test("rejects credentials in the URL", () => {
  assert.ok(!parseConfig({ url: "https://u:p@mcp.executor.sh/mcp", token: "k" }).ok);
  assert.ok(!parseConfig({ url: "https://mcp.executor.sh/mcp?token=k", token: "k" }).ok);
});

test("rejects a missing URL or key", () => {
  assert.ok(!parseConfig({ url: "", token: "k" }).ok);
  assert.ok(!parseConfig({ url: "https://mcp.executor.sh/mcp", token: "  " }).ok);
});

test("tool names fit provider rules", () => {
  assert.equal(bbToolName("execute"), "executor_execute");
  assert.equal(bbToolName("a.b c"), "executor_a_b_c");
  assert.equal(bbToolName("x".repeat(100)).length, 64);
});
