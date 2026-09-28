import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createTestHarness } from "wrangler";
import { ERAS, probe } from "../scripts/probe.mjs";

const server = createTestHarness({ workers: [{ configPath: "./wrangler.jsonc" }] });
let mcpUrl;

before(async () => {
  const { url } = await server.listen();
  mcpUrl = new URL("/mcp", url).href;
});
after(() => server.close());

describe("MCP over Streamable HTTP", () => {
  for (const era of ERAS) {
    test(`${era.label}: tools/list and tools/call`, async () => {
      const r = await probe(mcpUrl, era);
      assert.equal(r.era, era.label === "legacy" ? "legacy" : "modern");
      assert.deepEqual(r.tools.sort(), ["add", "server_time", "slugify"]);
      assert.deepEqual(r.call.structuredContent, { sum: 5 });
      assert.equal(r.call.isError ?? false, false);
    });

    test(`${era.label}: zero-argument tool`, async () => {
      const client = new Client({ name: "test", version: "0.0.0" }, era.options);
      await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
      try {
        const result = await client.callTool({ name: "server_time", arguments: {} });
        assert.equal(result.isError ?? false, false);
        assert.ok(!Number.isNaN(Date.parse(result.structuredContent.now)));
      } finally {
        await client.close();
      }
    });
  }
});

test("non-MCP path returns 404", async () => {
  const res = await server.fetch("/nope");
  assert.equal(res.status, 404);
});
