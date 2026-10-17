import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost, makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import { createPlugin } from "../server.ts";
import { FAKE_INSTRUCTIONS, FAKE_TOKEN, FAKE_URL, fakeExecutor } from "./fake-executor.ts";

async function loaded(settings: Record<string, string> = { url: FAKE_URL.href, token: FAKE_TOKEN }) {
  const executor = fakeExecutor();
  const { bb, harness } = createFakePluginHost({ pluginId: "executor", settings });
  await createPlugin({ fetch: executor.fetch })(bb);
  return { executor, harness };
}

test("registers each Executor tool with the executor_ prefix", async () => {
  const { harness } = await loaded();
  const config = await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext());
  assert.deepEqual(config?.tools.map((t: { name: string }) => t.name), ["executor_search", "executor_execute", "executor_chart"]);
  assert.match(config?.instructions ?? "", new RegExp(FAKE_INSTRUCTIONS));
  await harness.lifecycle.dispose();
});

test("passes a call through and returns the structured value once", async () => {
  const { harness } = await loaded();
  const result = await harness.behavior.callAgentTool("executor_execute", { code: "return 1" });
  assert.deepEqual(result, {
    content: [{ type: "text", text: JSON.stringify({ status: "completed", execution: { ok: true, result: "return 1" } }) }],
  });
  await harness.lifecycle.dispose();
});

test("sends the API key as a bearer header, never in the URL", async () => {
  const { executor, harness } = await loaded();
  await harness.behavior.callAgentTool("executor_search", { query: "issues" });
  assert.ok(executor.requests.length > 0);
  for (const request of executor.requests) {
    assert.equal(request.headers.get("authorization"), `Bearer ${FAKE_TOKEN}`);
    assert.ok(!request.url.includes(FAKE_TOKEN));
  }
  await harness.lifecycle.dispose();
});

test("an upstream tool error reaches the agent as a tool error", async () => {
  const { harness } = await loaded();
  const result = await harness.behavior.callAgentTool("executor_execute", { code: "fail" });
  assert.deepEqual(result, { content: [{ type: "text", text: "boom" }], isError: true });
  await harness.lifecycle.dispose();
});

test("passes images through as image parts", async () => {
  const { harness } = await loaded();
  const result = await harness.behavior.callAgentTool("executor_chart", {});
  assert.deepEqual(result, { content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }] });
  await harness.lifecycle.dispose();
});

test("asks for configuration when the URL or key is missing", async () => {
  const { harness } = await loaded({ url: "", token: "" });
  assert.equal(harness.needsConfigurationMessages.length, 1);
  assert.equal(harness.registrations.agentTools.length, 0);
  await harness.lifecycle.dispose();
});

test("asks for configuration when Executor rejects the key", async () => {
  const { harness } = await loaded({ url: FAKE_URL.href, token: "wrong" });
  assert.match(harness.needsConfigurationMessages[0] ?? "", /rejected the API key/);
  assert.equal(harness.registrations.agentTools.length, 0);
  await harness.lifecycle.dispose();
});

test("explains a key that belongs to another organization", async () => {
  const { harness } = await loaded({ url: FAKE_URL.href, token: "exp_other_org" });
  assert.match(harness.needsConfigurationMessages[0] ?? "", /cannot use this organization/);
  await harness.lifecycle.dispose();
});

test("speaks stateless MCP 2026-07-28 with no session", async () => {
  const { executor, harness } = await loaded();
  await harness.behavior.callAgentTool("executor_search", { query: "issues" });
  const call = executor.requests.find((r) => r.headers.get("mcp-method") === "tools/call");
  assert.equal(call?.headers.get("mcp-protocol-version"), "2026-07-28");
  assert.ok(executor.requests.every((r) => !r.headers.has("mcp-session-id")));
  await harness.lifecycle.dispose();
});
