import assert from "node:assert/strict";
import { test } from "node:test";
import { CallCancelledError, ExecutorConnection } from "./connection.ts";
import { connectionUrl, fakeExecutor } from "./fake-executor.ts";
import { discover, pollDevice, registerClient, startDevice } from "./oauth.ts";

async function signedIn() {
  const executor = fakeExecutor();
  const url = new URL(connectionUrl("c_1"));
  const endpoints = await discover(url, executor.fetch);
  const clientId = await registerClient(endpoints, { kind: "device" }, executor.fetch);
  const start = await startDevice(endpoints, clientId, executor.fetch);
  const tokens = await pollDevice(endpoints, clientId, start, { fetch: executor.fetch, signal: new AbortController().signal, sleep: async () => {} });
  return { executor, url, token: tokens.accessToken };
}

test("cancelling the agent's call aborts the request and says so", async () => {
  const { executor, url, token } = await signedIn();
  const connection = new ExecutorConnection(url, async () => token, { fetch: executor.fetch });
  await connection.listTools();
  const controller = new AbortController();
  const call = connection.callTool("execute", { code: "hang" }, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(call, CallCancelledError);
  await connection.close();
});

test("reconnects after a failed connection instead of caching the failure", async () => {
  const { executor, url, token } = await signedIn();
  let down = true;
  const flaky = (input: string | URL, init?: RequestInit) =>
    down ? Promise.reject(new TypeError("fetch failed")) : executor.fetch(input, init);
  const connection = new ExecutorConnection(url, async () => token, { fetch: flaky });
  await assert.rejects(connection.listTools());
  down = false;
  assert.ok((await connection.listTools()).some((t) => t.name === "execute"));
  await connection.close();
});

test("discovery refuses metadata that names a different resource", async () => {
  const executor = fakeExecutor();
  const lying = async (input: string | URL, init?: RequestInit) => {
    const response = await executor.fetch(input, init);
    if (String(input).includes("oauth-protected-resource")) {
      return Response.json({ resource: "https://evil.test/mcp", authorization_servers: ["https://auth.test/api/auth"] });
    }
    return response;
  };
  await assert.rejects(discover(new URL(connectionUrl("c_1")), lying), /different resource/);
});
