import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";

// Props set by completeAuthorization() in github-handler.ts; available as this.props
export type Props = {
  login: string;
  name: string;
  email: string;
  accessToken: string;
};

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({ name: "GitHub OAuth MCP Demo", version: "0.1.0" });

  async init() {
    this.server.tool(
      "add",
      "Add two numbers",
      { a: z.number(), b: z.number() },
      async ({ a, b }) => ({
        content: [{ type: "text", text: String(a + b) }],
      }),
    );

    this.server.tool(
      "fetchTitle",
      "Fetch a URL and return its HTML <title>",
      { url: z.string().url() },
      async ({ url }) => {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return { isError: true, content: [{ type: "text", text: "Only http(s) URLs are allowed" }] };
        }
        let res: Response;
        try {
          res = await fetch(parsed.toString(), {
            headers: { "User-Agent": `mcp-title-fetcher (${this.props.login})`, Accept: "text/html" },
            redirect: "follow",
          });
        } catch (err) {
          return { isError: true, content: [{ type: "text", text: `Fetch failed: ${String(err)}` }] };
        }
        if (!res.ok) {
          return { isError: true, content: [{ type: "text", text: `HTTP ${res.status}` }] };
        }
        let title = "";
        await new HTMLRewriter()
          .on("title", {
            text(chunk) {
              title += chunk.text;
            },
          })
          .transform(res)
          .arrayBuffer();
        title = title.trim();
        return {
          content: [{ type: "text", text: title || "(no title found)" }],
        };
      },
    );
  }
}

export default new OAuthProvider({
  apiHandlers: {
    "/sse": MyMCP.serveSSE("/sse"),
    "/mcp": MyMCP.serve("/mcp"),
  },
  // @ts-expect-error Hono app's fetch signature is compatible at runtime
  defaultHandler: GitHubHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
