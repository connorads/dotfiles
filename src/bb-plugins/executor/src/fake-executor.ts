import { createHash } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export const FAKE_ORIGIN = "https://executor.test";
export const FAKE_INSTRUCTIONS = "Use search before execute.";
const ISSUER = "https://auth.test/api/auth";

export const connectionUrl = (id: string) => `${FAKE_ORIGIN}/mcp?connection=${id}`;

type Client = { redirectUris: string[] };
type AuthCode = { clientId: string; redirectUri: string; challenge: string; resource: string };
type Device = { clientId: string; resource: string; userCode: string; decision: "pending" | "approved" | "denied" };
type Grant = { clientId: string; resource: string };

/**
 * An in-process stand-in for Executor: OAuth browser and device sign-in
 * with rotating refresh tokens, grants bound to one connection URL, and the
 * model-mode MCP tools, served by the real MCP server SDK. `guardDevice`
 * puts the device endpoint behind a sign-in gateway, as a self-hosted
 * Executor behind an access proxy does.
 */
export function fakeExecutor(options: { autoApprove?: boolean; guardDevice?: boolean } = {}) {
  let counter = 0;
  const next = (prefix: string) => `${prefix}_${++counter}`;
  const clients = new Map<string, Client>();
  const codes = new Map<string, AuthCode>();
  const devices = new Map<string, Device>();
  const accessTokens = new Map<string, Grant & { expired: boolean }>();
  const refreshTokens = new Map<string, Grant>();
  const requests: Request[] = [];
  let autoApprove = options.autoApprove ?? true;
  /** Tests call sequentially, so the request being served names the connection. */
  let currentConnection: string | null = null;

  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "fake-executor", version: "0.0.0" }, { instructions: FAKE_INSTRUCTIONS });
    server.registerTool("search", { description: "Find tools.", inputSchema: z.object({ query: z.string() }) },
      async ({ query }) => structured({ items: [{ path: `tools.linear.${query}` }] }));
    server.registerTool("execute", { description: "Run a program.", inputSchema: z.object({ code: z.string() }) },
      async ({ code }, ctx) => {
        if (code === "fail") return { content: [{ type: "text", text: "boom" }], isError: true };
        if (code === "hang") {
          await new Promise((resolve) => ctx.mcpReq.signal.addEventListener("abort", resolve, { once: true }));
          return structured({ status: "unavailable" });
        }
        return structured({ status: "completed", execution: { ok: true, result: code } });
      });
    server.registerTool("chart", { description: "Return an image.", inputSchema: z.object({}) },
      async () => ({ content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }] }));
    server.registerTool("whoami", { description: "Name the connection.", inputSchema: z.object({}) },
      async () => structured({ connection: currentConnection }));
    return server;
  });

  const oauth = (status: number, body: unknown) => Response.json(body, { status });

  async function token(form: URLSearchParams): Promise<Response> {
    const issue = (grant: Grant) => {
      const access = next("at");
      const refresh = next("rt");
      accessTokens.set(access, { ...grant, expired: false });
      refreshTokens.set(refresh, grant);
      return oauth(200, { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: "Bearer" });
    };
    if (form.get("grant_type") === "urn:ietf:params:oauth:grant-type:device_code") {
      const device = devices.get(form.get("device_code") ?? "");
      if (!device || device.clientId !== form.get("client_id")) return oauth(400, { error: "invalid_grant" });
      if (device.decision === "pending" && autoApprove) device.decision = "approved";
      if (device.decision === "pending") return oauth(400, { error: "authorization_pending" });
      if (device.decision === "denied") return oauth(400, { error: "access_denied" });
      devices.delete(form.get("device_code")!);
      return issue({ clientId: device.clientId, resource: device.resource });
    }
    if (form.get("grant_type") === "authorization_code") {
      const code = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const valid = code && code.clientId === form.get("client_id") && code.redirectUri === form.get("redirect_uri")
        && code.challenge === createHash("sha256").update(verifier).digest("base64url") && code.resource === form.get("resource");
      if (!valid) return oauth(400, { error: "invalid_grant" });
      return issue({ clientId: code.clientId, resource: code.resource });
    }
    if (form.get("grant_type") === "refresh_token") {
      const grant = refreshTokens.get(form.get("refresh_token") ?? "");
      if (!grant || grant.clientId !== form.get("client_id")) return oauth(400, { error: "invalid_grant" });
      refreshTokens.delete(form.get("refresh_token")!);
      return issue(grant);
    }
    return oauth(400, { error: "unsupported_grant_type" });
  }

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    requests.push(request.clone());
    const url = new URL(request.url);
    if (url.origin === FAKE_ORIGIN && url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      return oauth(200, { resource: `${FAKE_ORIGIN}/mcp${url.search}`, authorization_servers: [ISSUER] });
    }
    if (url.href === "https://auth.test/.well-known/oauth-authorization-server/api/auth") {
      return oauth(200, {
        issuer: ISSUER,
        token_endpoint: "https://auth.test/oauth2/token",
        registration_endpoint: "https://auth.test/oauth2/register",
        authorization_endpoint: "https://auth.test/oauth2/authorize",
        device_authorization_endpoint: "https://auth.test/oauth2/device",
        authorization_response_iss_parameter_supported: true,
        revocation_endpoint: "https://auth.test/oauth2/revoke",
      });
    }
    if (url.href === "https://auth.test/oauth2/register") {
      const body = (await request.json()) as { redirect_uris?: string[] };
      const clientId = next("client");
      clients.set(clientId, { redirectUris: body.redirect_uris ?? [] });
      return oauth(201, { client_id: clientId });
    }
    if (url.href === "https://auth.test/oauth2/device" && options.guardDevice) {
      return new Response(null, { status: 302, headers: { location: "https://gateway.test/login" } });
    }
    if (url.href === "https://auth.test/oauth2/device") {
      const form = new URLSearchParams(await request.text());
      const clientId = form.get("client_id") ?? "";
      if (!clients.has(clientId)) return oauth(401, { error: "invalid_client" });
      const deviceCode = next("dc");
      const userCode = `CODE-${counter}`;
      devices.set(deviceCode, { clientId, resource: form.get("resource") ?? "", userCode, decision: "pending" });
      return oauth(200, {
        device_code: deviceCode, user_code: userCode, verification_uri: "https://auth.test/device",
        verification_uri_complete: `https://auth.test/device?code=${userCode}`, expires_in: 600, interval: 1,
      });
    }
    if (url.href === "https://auth.test/oauth2/token") return token(new URLSearchParams(await request.text()));
    if (url.href === "https://auth.test/oauth2/revoke") {
      refreshTokens.delete(new URLSearchParams(await request.text()).get("token") ?? "");
      return new Response(null, { status: 200 });
    }
    if (url.origin === FAKE_ORIGIN && url.pathname === "/mcp") {
      const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      const grant = accessTokens.get(bearer);
      // A grant serves only the URL it was issued for, as Executor's deliveryRefusal does.
      if (!grant || grant.expired || grant.resource !== url.href) return new Response("unauthorized", { status: 401 });
      currentConnection = url.searchParams.get("connection");
      return handler.fetch(request);
    }
    return new Response("not found", { status: 404 });
  };

  /**
   * Plays the person approving in a browser: checks the request as an
   * authorization server would and returns where it redirects back to.
   */
  function authorize(authorizeUrl: string, decision: "approve" | "deny" = "approve", iss = ISSUER): string {
    const params = new URL(authorizeUrl).searchParams;
    const clientId = params.get("client_id") ?? "";
    const redirectUri = params.get("redirect_uri") ?? "";
    if (!clients.get(clientId)?.redirectUris.includes(redirectUri)) throw new Error("unregistered redirect URI");
    if (params.get("code_challenge_method") !== "S256" || params.get("response_type") !== "code") throw new Error("bad request");
    const back = new URL(redirectUri);
    back.searchParams.set("state", params.get("state") ?? "");
    back.searchParams.set("iss", iss);
    if (decision === "deny") {
      back.searchParams.set("error", "access_denied");
      return back.href;
    }
    const code = next("code");
    codes.set(code, { clientId, redirectUri, challenge: params.get("code_challenge") ?? "", resource: params.get("resource") ?? "" });
    back.searchParams.set("code", code);
    return back.href;
  }

  return {
    fetch,
    authorize,
    requests,
    clients,
    refreshTokens,
    setAutoApprove(value: boolean) {
      autoApprove = value;
    },
    decide(decision: "approved" | "denied") {
      for (const device of devices.values()) device.decision = decision;
    },
    expireAccessTokens() {
      for (const grant of accessTokens.values()) grant.expired = true;
    },
    revokeEverything() {
      accessTokens.clear();
      refreshTokens.clear();
    },
    forgetClients() {
      clients.clear();
    },
  };
}

function structured(value: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
}
