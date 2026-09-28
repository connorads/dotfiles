import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    OAUTH_KV: KVNamespace;
    MCP_OBJECT: DurableObjectNamespace;
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    COOKIE_ENCRYPTION_KEY: string;
    OAUTH_PROVIDER: OAuthHelpers;
  }
}
export {};
