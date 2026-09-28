import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { z } from "zod";

async function createServer() {
  const server = new McpServer({ name: "flags-mcp", version: "0.4.0" });
  server.registerTool(
    "search_docs",
    { description: "Search internal docs", inputSchema: z.object({ q: z.string() }) },
    async ({ q }) => ({ content: [{ type: "text", text: `results for ${q}` }] }),
  );
  if ((await env.FLAGS.get("beta_reports")) === "on") {
    server.registerTool(
      "run_report",
      { description: "Run a named analytics report", inputSchema: z.object({ name: z.string() }) },
      async ({ name }) => {
        // tell clients the list changed in case they cached it
        server.sendToolListChanged();
        return { content: [{ type: "text", text: `report ${name}: ok` }] };
      },
    );
  }
  return server;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const mcp = createMcpHandler(createServer, { route: "/mcp" });
    if (url.pathname === "/admin/flags" && request.method === "POST") {
      if (request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
        return new Response("forbidden", { status: 403 });
      }
      const { flag, value } = await request.json<{ flag: string; value: string }>();
      await env.FLAGS.put(flag, value);
      mcp.notify.toolsChanged();
      return new Response("ok");
    }
    if (url.pathname === "/mcp") return mcp(request, env, ctx);
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
