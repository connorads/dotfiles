import assert from "node:assert/strict";
import { test } from "node:test";
import { CallCancelledError, ExecutorConnection } from "./connection.ts";
import { FAKE_TOKEN, FAKE_URL, fakeExecutor } from "./fake-executor.ts";

test("cancelling the agent's call aborts the request and says so", async () => {
  const executor = fakeExecutor();
  const connection = new ExecutorConnection({ url: FAKE_URL, token: FAKE_TOKEN }, { fetch: executor.fetch });
  await connection.listTools();
  const controller = new AbortController();
  const call = connection.callTool("execute", { code: "hang" }, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(call, CallCancelledError);
  await connection.close();
});

test("reconnects after a failed connection instead of caching the failure", async () => {
  const executor = fakeExecutor();
  let down = true;
  const flaky = (url: string | URL | Request, init?: RequestInit) =>
    down ? Promise.reject(new TypeError("fetch failed")) : executor.fetch(url, init);
  const connection = new ExecutorConnection({ url: FAKE_URL, token: FAKE_TOKEN }, { fetch: flaky });
  await assert.rejects(connection.listTools());
  down = false;
  const tools = await connection.listTools();
  assert.ok(tools.some((t) => t.name === "execute"));
  await connection.close();
});
