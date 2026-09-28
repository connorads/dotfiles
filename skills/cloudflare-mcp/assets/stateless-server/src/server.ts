import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

// The handler calls this once per request. Keep per-request state inside it.
export function createServer() {
  const server = new McpServer({ name: "stateless-mcp-server", version: "0.1.0" });

  server.registerTool(
    "add",
    {
      title: "Add numbers",
      description: "Add two numbers and return the sum.",
      inputSchema: z.object({
        a: z.number().describe("First addend"),
        b: z.number().describe("Second addend"),
      }),
      outputSchema: z.object({ sum: z.number() }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ a, b }) => {
      const result = { sum: a + b };
      // structuredContent must match outputSchema. The text block serves clients that ignore it.
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  server.registerTool(
    "slugify",
    {
      title: "Slugify text",
      description: "Turn text into a lowercase URL slug.",
      inputSchema: z.object({ text: z.string().min(1).describe("Text to convert") }),
      outputSchema: z.object({ slug: z.string() }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ text }) => {
      const slug = text
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const result = { slug };
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  // No inputSchema: the callback's only argument is the request context.
  server.registerTool(
    "server_time",
    {
      title: "Server time",
      description: "Return the server's current time as an ISO 8601 string.",
      outputSchema: z.object({ now: z.string() }),
      annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (context) => {
      context.mcpReq.signal.throwIfAborted();
      const result = { now: new Date().toISOString() };
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  return server;
}
