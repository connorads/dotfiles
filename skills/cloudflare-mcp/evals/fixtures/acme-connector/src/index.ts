import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { authHandler } from "./auth";
import { createServer } from "./server";

const mcp = createMcpHandler(createServer, { route: "/mcp" });

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: { fetch: (req: Request, env: Env, ctx: ExecutionContext) => mcp(req, env, ctx) },
  defaultHandler: authHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: ["mcp:read", "offline_access"],
  resourceMetadata: {
    // copied from the first deploy
    resource: "https://acme-mcp.acme-platform.workers.dev/mcp",
    scopes_supported: ["mcp:read"],
  },
});
