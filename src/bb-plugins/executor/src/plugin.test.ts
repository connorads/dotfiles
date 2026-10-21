import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost, makePluginAgentConfigurationContext, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import type { StateView } from "../contracts.ts";
import { createPlugin } from "../server.ts";
import { connectionUrl, FAKE_INSTRUCTIONS, fakeExecutor } from "./fake-executor.ts";

const instant = async (_ms: number, signal: AbortSignal) => {
  if (signal.aborted) throw signal.reason;
  await new Promise((resolve) => setImmediate(resolve));
};

async function setup(options: { autoApprove?: boolean; guardDevice?: boolean } = {}) {
  const executor = fakeExecutor(options);
  let reloads = 0;
  const factory = () => createPlugin({ fetch: executor.fetch, sleep: instant, reload: () => reloads++ });
  const first = createFakePluginHost({ pluginId: "executor", loopbackBaseUrl: "http://127.0.0.1:38886" });
  await factory()(first.bb);
  /** A reload hands back a new host; every helper follows the current one. */
  let host = first;
  const rpc = <T>(method: string, input: unknown = null) => host.harness.behavior.callRpc(method, input) as Promise<T>;
  const state = () => rpc<StateView>("state");
  const waitFor = async (check: (s: StateView) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const s = await state();
      if (check(s)) return s;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.fail(`state never matched: ${JSON.stringify(await state())}`);
  };
  /** The browser leg: approve at the authorization server, then follow its redirect into BB. */
  const approveInBrowser = async (id: string, decision: "approve" | "deny" = "approve", iss?: string) => {
    const pending = await waitFor((s) => s.signIns.some((x) => x.id === id && x.kind === "browser"));
    const signIn = pending.signIns.find((x) => x.id === id);
    assert.ok(signIn?.kind === "browser");
    const back = new URL(executor.authorize(signIn.url, decision, iss));
    assert.equal(`${back.origin}${back.pathname}`, "http://127.0.0.1:38886/api/v1/plugins/executor/http/oauth/callback");
    return host.harness.behavior.fetchHttp("GET", `/oauth/callback${back.search}`);
  };
  /** Adds and signs in to a connection in the browser. */
  const connect = async (name: string, id: string) => {
    const added = await rpc<{ ok: boolean; id: string }>("add", { name, url: connectionUrl(id) });
    assert.ok(added.ok);
    await rpc("signIn", { id: added.id, method: "browser" });
    const page = await approveInBrowser(added.id);
    assert.equal(page.status, 200);
    await waitFor((s) => s.connections.find((c) => c.id === added.id)?.status === "signed-in" && s.toolsReady);
    return added.id;
  };
  const reload = async () => {
    host = await host.harness.lifecycle.reload(factory());
  };
  const tools = async (threadId = "thread-test") =>
    (await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: threadId } as never }))).tools.map((t) => t.name);
  const whoami = async (threadId: string) => {
    const result = await host.harness.behavior.callAgentTool("executor_whoami", {}, { threadId });
    assert.ok(typeof result !== "string" && !result.isError, JSON.stringify(result));
    return JSON.parse((result.content[0] as { text: string }).text).connection as string;
  };
  return {
    executor, rpc, state, waitFor, connect, approveInBrowser, reload, tools, whoami,
    reloads: () => reloads,
    get harness() {
      return host.harness;
    },
  };
}

test("starts with no tools and no connections", async () => {
  const t = await setup();
  assert.deepEqual(await t.tools(), []);
  assert.deepEqual((await t.state()).connections, []);
  await t.harness.lifecycle.dispose();
});

test("draft selection applies before first-session tools, survives reload, and leaves other threads alone", async () => {
  const t = await setup();
  await t.connect("Coding", "c_1");
  const ops = await t.connect("Ops", "c_2");
  await t.reload();
  const hook = t.harness.inspection.registrations.hooks["message.dispatch"];
  assert.ok(hook);
  await hook(makeMessageDispatchHookContext({ thread: { id: "draft-off" }, experimental_submission: {
    pluginId: "executor", data: { executorChoice: { kind: "off" } },
  } }));
  assert.deepEqual(await t.tools("draft-off"), []);
  assert.ok((await t.tools("unrelated")).length > 0);
  await hook(makeMessageDispatchHookContext({ thread: { id: "draft-ops" }, experimental_submission: {
    pluginId: "executor", data: { executorChoice: { kind: "connection", id: ops } },
  } }));
  assert.equal(await t.whoami("draft-ops"), "c_2");
  await hook(makeMessageDispatchHookContext({ thread: { id: "unrelated" }, experimental_submission: {
    pluginId: "other-plugin", data: { executorChoice: { kind: "off" } },
  } }));
  assert.ok((await t.tools("unrelated")).length > 0);
  await t.reload();
  assert.deepEqual(await t.tools("draft-off"), []);
  await t.harness.lifecycle.dispose();
});

test("browser sign-in stores the grant, learns the tools and asks for one reload", async () => {
  const t = await setup();
  await t.connect("Coding", "c_1");
  assert.equal(t.reloads(), 1);
  await t.reload();
  assert.deepEqual(await t.tools(), ["executor_search", "executor_execute", "executor_chart", "executor_whoami"]);
  const config = await t.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext());
  assert.match(config.instructions ?? "", new RegExp(FAKE_INSTRUCTIONS));
  await t.harness.lifecycle.dispose();
});

test("a callback works once and must come from the issuer", async () => {
  const t = await setup();
  const added = await t.rpc<{ ok: true; id: string }>("add", { name: "Coding", url: connectionUrl("c_1") });
  await t.rpc("signIn", { id: added.id, method: "browser" });
  const forged = await t.approveInBrowser(added.id, "approve", "https://evil.test/api/auth");
  assert.equal(forged.status, 400);
  assert.match((await t.state()).errors[added.id] ?? "", /different server/);
  const replay = await t.harness.behavior.fetchHttp("GET", "/oauth/callback?state=made-up&code=x");
  assert.equal(replay.status, 400);
  assert.equal((await t.state()).connections[0]?.status, "signed-out");
  await t.harness.lifecycle.dispose();
});

test("a declined browser sign-in stays signed out with the reason", async () => {
  const t = await setup();
  const added = await t.rpc<{ ok: true; id: string }>("add", { name: "Coding", url: connectionUrl("c_1") });
  await t.rpc("signIn", { id: added.id, method: "browser" });
  const page = await t.approveInBrowser(added.id, "deny");
  assert.equal(page.status, 400);
  const s = await t.state();
  assert.equal(s.connections[0]?.status, "signed-out");
  assert.match(s.errors[added.id] ?? "", /declined/);
  await t.harness.lifecycle.dispose();
});

test("a server that guards device sign-in says so instead of failing vaguely", async () => {
  const t = await setup({ guardDevice: true });
  const added = await t.rpc<{ ok: true; id: string }>("add", { name: "Self-hosted", url: connectionUrl("c_1") });
  await t.rpc("signIn", { id: added.id, method: "device" });
  const s = await t.waitFor((x) => x.errors[added.id] !== undefined);
  assert.match(s.errors[added.id] ?? "", /redirects to gateway\.test.*Use Sign in instead/);
  assert.equal(s.connections[0]?.status, "signed-out");
  await t.harness.lifecycle.dispose();
});

test("device sign-in shows a code and completes once approved", async () => {
  const t = await setup({ autoApprove: false });
  const added = await t.rpc<{ ok: true; id: string }>("add", { name: "Coding", url: connectionUrl("c_1") });
  await t.rpc("signIn", { id: added.id, method: "device" });
  const pending = await t.waitFor((s) => s.signIns.length === 1);
  assert.equal(pending.connections[0]?.status, "signing-in");
  const signIn = pending.signIns[0];
  assert.ok(signIn?.kind === "device");
  assert.match(signIn.verificationUriComplete ?? "", /code=CODE-/);
  t.executor.decide("approved");
  await t.waitFor((s) => s.connections[0]?.status === "signed-in" && s.toolsReady);
  await t.harness.lifecycle.dispose();
});

test("a declined device sign-in reports the reason and stays signed out", async () => {
  const t = await setup({ autoApprove: false });
  const added = await t.rpc<{ ok: true; id: string }>("add", { name: "Coding", url: connectionUrl("c_1") });
  await t.rpc("signIn", { id: added.id, method: "device" });
  await t.waitFor((s) => s.signIns.length === 1);
  t.executor.decide("denied");
  const s = await t.waitFor((x) => x.errors[added.id] !== undefined);
  assert.equal(s.connections[0]?.status, "signed-out");
  assert.match(s.errors[added.id] ?? "", /declined/);
  await t.harness.lifecycle.dispose();
});

test("each thread calls its own connection and can switch without a restart", async () => {
  const t = await setup();
  const coding = await t.connect("Coding", "c_1");
  const ops = await t.connect("Ops", "c_2");
  await t.reload();
  assert.equal(await t.whoami("thread-a"), "c_1", "the first connection is the default");
  await t.rpc("setThreadChoice", { threadId: "thread-b", choice: { kind: "connection", id: ops } });
  assert.equal(await t.whoami("thread-b"), "c_2");
  assert.equal(await t.whoami("thread-a"), "c_1");
  await t.rpc("setThreadChoice", { threadId: "thread-b", choice: { kind: "connection", id: coding } });
  assert.equal(await t.whoami("thread-b"), "c_1");
  await t.rpc("setDefault", { id: ops });
  assert.equal(await t.whoami("thread-a"), "c_2");
  await t.harness.lifecycle.dispose();
});

test("a thread's choice survives a plugin reload", async () => {
  const t = await setup();
  await t.connect("Coding", "c_1");
  const ops = await t.connect("Ops", "c_2");
  await t.rpc("setThreadChoice", { threadId: "thread-b", choice: { kind: "connection", id: ops } });
  await t.reload();
  assert.deepEqual(await t.rpc("threadChoice", { threadId: "thread-b" }), { kind: "connection", id: ops });
  assert.equal(await t.whoami("thread-b"), "c_2");
  await t.harness.lifecycle.dispose();
});

test("turning Executor off removes the tools and refuses calls", async () => {
  const t = await setup();
  await t.connect("Coding", "c_1");
  await t.reload();
  await t.rpc("setThreadChoice", { threadId: "thread-off", choice: { kind: "off" } });
  assert.deepEqual(await t.tools("thread-off"), []);
  const result = await t.harness.behavior.callAgentTool("executor_whoami", {}, { threadId: "thread-off" });
  assert.ok(typeof result !== "string" && result.isError);
  assert.match((result.content[0] as { text: string }).text, /off for this thread/);
  await t.harness.lifecycle.dispose();
});

test("an expired access token is refreshed once and the rotated refresh token saved", async () => {
  const t = await setup();
  await t.connect("Coding", "c_1");
  await t.reload();
  const before = [...t.executor.refreshTokens.keys()];
  t.executor.expireAccessTokens();
  assert.equal(await t.whoami("thread-a"), "c_1");
  const after = [...t.executor.refreshTokens.keys()];
  assert.equal(after.length, 1);
  assert.notDeepEqual(after, before, "the refresh token rotated");
  t.executor.expireAccessTokens();
  assert.equal(await t.whoami("thread-a"), "c_1", "the saved rotated token works again");
  await t.harness.lifecycle.dispose();
});

test("a revoked sign-in turns into signed-out with a clear message", async () => {
  const t = await setup();
  const id = await t.connect("Coding", "c_1");
  await t.reload();
  t.executor.revokeEverything();
  const first = await t.harness.behavior.callAgentTool("executor_whoami", {}, { threadId: "thread-a" });
  assert.ok(typeof first !== "string" && first.isError);
  const second = await t.harness.behavior.callAgentTool("executor_whoami", {}, { threadId: "thread-a" });
  assert.ok(typeof second !== "string" && second.isError);
  assert.match((second.content[0] as { text: string }).text, /Sign in again|signed out/);
  assert.equal((await t.state()).connections.find((c) => c.id === id)?.status, "signed-out");
  await t.harness.lifecycle.dispose();
});

test("signing out revokes the refresh token", async () => {
  const t = await setup();
  const id = await t.connect("Coding", "c_1");
  assert.equal(t.executor.refreshTokens.size, 1);
  await t.rpc("signOut", { id });
  assert.equal(t.executor.refreshTokens.size, 0);
  assert.equal((await t.state()).connections[0]?.status, "signed-out");
  await t.harness.lifecycle.dispose();
});

test("a device client registration the server forgot is replaced", async () => {
  const t = await setup();
  const added = await t.rpc<{ ok: true; id: string }>("add", { name: "Coding", url: connectionUrl("c_1") });
  const id = added.id;
  await t.rpc("signIn", { id, method: "device" });
  await t.waitFor((s) => s.connections[0]?.status === "signed-in");
  await t.rpc("signOut", { id });
  t.executor.forgetClients();
  await t.rpc("signIn", { id, method: "device" });
  await t.waitFor((s) => s.connections[0]?.status === "signed-in");
  await t.harness.lifecycle.dispose();
});

test("tokens never appear in RPC state", async () => {
  const t = await setup();
  await t.connect("Coding", "c_1");
  const raw = JSON.stringify(await t.state());
  assert.ok(!/at_\d|rt_\d/.test(raw), raw);
  await t.harness.lifecycle.dispose();
});

test("passes results through: structured once, images, upstream errors", async () => {
  const t = await setup();
  await t.connect("Coding", "c_1");
  await t.reload();
  assert.deepEqual(await t.harness.behavior.callAgentTool("executor_execute", { code: "return 1" }), {
    content: [{ type: "text", text: JSON.stringify({ status: "completed", execution: { ok: true, result: "return 1" } }) }],
  });
  assert.deepEqual(await t.harness.behavior.callAgentTool("executor_chart", {}), {
    content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }],
  });
  assert.deepEqual(await t.harness.behavior.callAgentTool("executor_execute", { code: "fail" }), {
    content: [{ type: "text", text: "boom" }],
    isError: true,
  });
  await t.harness.lifecycle.dispose();
});

test("speaks stateless MCP 2026-07-28 with the token only in the header", async () => {
  const t = await setup();
  await t.connect("Coding", "c_1");
  await t.reload();
  await t.harness.behavior.callAgentTool("executor_search", { query: "issues" });
  const mcp = t.executor.requests.filter((r) => new URL(r.url).pathname === "/mcp");
  const call = mcp.find((r) => r.headers.get("mcp-method") === "tools/call");
  assert.equal(call?.headers.get("mcp-protocol-version"), "2026-07-28");
  assert.ok(mcp.every((r) => !r.headers.has("mcp-session-id")));
  assert.ok(mcp.every((r) => /^Bearer at_\d+$/.test(r.headers.get("authorization") ?? "") && !r.url.includes("at_")));
  await t.harness.lifecycle.dispose();
});
