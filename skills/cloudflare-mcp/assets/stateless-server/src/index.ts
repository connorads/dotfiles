import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./server";

// Module scope: one handler per isolate. It builds a fresh McpServer per request.
// Default `legacy: "stateless"` serves 2025-era and 2026-07-28 clients on the same route.
// On a custom domain add `allowedHostnames: ["mcp.example.com"]`.
const mcp = createMcpHandler(createServer, { route: "/mcp" });

// Object export: agents' handler is a callable function, and a function default
// export would be treated as a WorkerEntrypoint class.
export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp") return mcp(request, env, ctx);
    if (pathname === "/") return new Response("MCP endpoint: /mcp\n");
    return new Response("Not found\n", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
