// Usage: node scripts/probe.mjs https://<worker>.workers.dev/mcp
// Connects once per protocol era and calls tools/list plus the `add` tool.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export const ERAS = [
  { label: "legacy", options: {} },
  { label: "auto", options: { versionNegotiation: { mode: "auto" } } },
  { label: "pin 2026-07-28", options: { versionNegotiation: { mode: { pin: "2026-07-28" } } } },
];

export async function probe(url, era) {
  const client = new Client({ name: "probe", version: "0.0.0" }, era.options);
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  try {
    const { tools } = await client.listTools();
    const call = await client.callTool({ name: "add", arguments: { a: 2, b: 3 } });
    return { era: client.getProtocolEra?.(), tools: tools.map((t) => t.name), call };
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node scripts/probe.mjs <server-url-ending-in-/mcp>");
    process.exit(2);
  }
  let failed = false;
  for (const era of ERAS) {
    try {
      const r = await probe(url, era);
      console.log(`${era.label}: era=${r.era} tools=${r.tools.join(",")} add=${JSON.stringify(r.call.structuredContent)}`);
    } catch (error) {
      failed = true;
      console.error(`${era.label}: FAILED ${error?.message ?? error}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
