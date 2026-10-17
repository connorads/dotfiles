import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export const FAKE_URL = new URL("https://executor.test/org/acme/mcp");
export const FAKE_TOKEN = "exp_test_token";
export const FAKE_INSTRUCTIONS = "Use search before execute.";

/**
 * An in-process stand-in for hosted Executor: the same model-mode tool names
 * and result shapes, served by the real MCP server SDK over Streamable HTTP.
 */
export function fakeExecutor() {
  const requests: Request[] = [];
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "fake-executor", version: "0.0.0" }, { instructions: FAKE_INSTRUCTIONS });
    server.registerTool(
      "search",
      { description: "Find tools.", inputSchema: z.object({ query: z.string() }) },
      async ({ query }) => structured({ items: [{ path: `tools.linear.${query}` }] }),
    );
    server.registerTool(
      "execute",
      { description: "Run a program.", inputSchema: z.object({ code: z.string() }) },
      async ({ code }, ctx) => {
        if (code === "fail") return { content: [{ type: "text", text: "boom" }], isError: true };
        if (code === "hang") {
          await new Promise((resolve) => ctx.mcpReq.signal.addEventListener("abort", resolve, { once: true }));
          return structured({ status: "unavailable" });
        }
        return structured({ status: "completed", execution: { ok: true, result: code } });
      },
    );
    server.registerTool(
      "chart",
      { description: "Return an image.", inputSchema: z.object({}) },
      async () => ({ content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }] }),
    );
    return server;
  });
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(url, init);
    requests.push(request.clone());
    if (request.headers.get("authorization") === "Bearer exp_other_org") {
      return Response.json({ error: "organization_mismatch" }, { status: 403 });
    }
    if (request.headers.get("authorization") !== `Bearer ${FAKE_TOKEN}`) {
      return new Response("unauthorized", { status: 401 });
    }
    return handler.fetch(request);
  };
  return { fetch, requests };
}

function structured(value: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
}
