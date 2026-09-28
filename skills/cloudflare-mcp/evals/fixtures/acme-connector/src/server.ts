import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";

export type Props = { email: string };

export function createServer() {
  const server = new McpServer({ name: "acme-mcp", version: "1.3.0" });
  server.registerTool(
    "whoami",
    { description: "Return the signed-in Acme user", inputSchema: z.object({}) },
    async () => {
      const props = getMcpAuthContext()?.props as Props | undefined;
      return { content: [{ type: "text", text: props?.email ?? "anonymous" }] };
    },
  );
  server.registerTool(
    "lookup_order",
    {
      description: "Look up an Acme order by id",
      inputSchema: z.object({ orderId: z.string().describe("Order id, e.g. ORD-1234") }),
    },
    async ({ orderId }) => ({ content: [{ type: "text", text: `order ${orderId}: shipped` }] }),
  );
  return server;
}
