# Authentication and authorization

Snapshot verified 2026-09-28 against `@cloudflare/workers-oauth-provider` 1.1.0 (npm tarball), `agents` 0.24.0 and `@modelcontextprotocol/server` 2.0.0. Claims about Cloudflare templates, docs pages and vendor connector docs are as of the same date.
Re-check before pinning: `pnpm view @cloudflare/workers-oauth-provider version` and `pnpm view agents@latest peerDependencies`.
The package ships its own guides: read `node_modules/@cloudflare/workers-oauth-provider/docs/` after install.

## Contents

1. Pick the model
2. OAuthProvider 1.x rules
3. Reading identity inside tools
4. Scopes
5. Complete example: GitHub upstream
6. Your own validator: Cloudflare Access or a third-party AS
7. Security checklist
8. Claude and ChatGPT connector requirements
9. Rate limiting per user and tool
10. What was not verified

Stateless handler options (`allowedHostnames`, CORS, Origin) live in [handler.md](handler.md). `McpAgent` `this.props` and 0.x provider migration live in [migrate.md](migrate.md). The protocol auth model lives in [spec.md](spec.md). Auth probes and deploy live in [testing-deploy.md](testing-deploy.md).

## 1. Pick the model

| Situation | Model | Server code |
| --- | --- | --- |
| Public read-only data, no per-user state | Authless | `export default { fetch: (r, e, c) => mcp(r, e, c) }`. Never add a half-auth that returns 200 without a token |
| Authless with writes (temporary, such as a prototype before OAuth) | Authless | Tell the user that anyone with the URL can write. Add the IP-keyed limiter ([testing-deploy.md](testing-deploy.md), rate limiting). Read identity through one helper that returns `"anonymous"` today, so adding OAuth later changes only that helper (section 3) |
| Users sign in with GitHub, Google, Sentry, etc. and tools call that API as them | Worker is the AS (`OAuthProvider`), upstream IdP behind `/authorize` | Section 5 |
| Your own user accounts | Worker is the AS, your sign-in page behind `/authorize` | Section 5 without the upstream leg: `beginConsent` then `approveConsent` then `completeAuthorization` |
| Workforce users already in Cloudflare Zero Trust | Cloudflare Access is the AS (Managed OAuth) | Section 6 |
| Auth0, WorkOS, Stytch, Descope or another external AS issues the tokens | Resource server only | Section 6 |
| Several resource Workers share one AS | `OAuthAuthorizationServer` + `OAuthResourceServer` over a Service Binding | Provider `docs/resource-servers.md`. On 1.1.0 `authorizeEndpoint` and `tokenEndpoint` are required there |

The Cloudflare `remote-mcp-*-oauth` templates (cloudflare/ai `demos/`) pin provider `^0.8.1`, use `McpAgent` and hand-rolled CSRF cookies. Borrow their upstream IdP settings, not their code.
Cloudflare's overview of these options: <https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/index.md>. Its code samples show provider 0.x and `McpAgent`, so take the options from it, not the code.

## 2. OAuthProvider 1.x rules

- `resourceMetadata.resource` is required. Without it construction throws `TypeError: resourceMetadata.resource is required and must be an absolute HTTPS URI without a fragment (http is accepted only on a loopback host)`. Construction runs at module load, so a bad `resource` stops `wrangler dev` from starting and fails the deploy's startup validation (observed with `wrangler dev`).
- `resource` is the exact public MCP URL including the path, for example `https://mcp.example.com/mcp`. It becomes the token audience. Port, path, query and trailing slash compare exactly.
- `http` is allowed only on loopback, so dev and prod differ: set `MCP_RESOURCE` in `vars` and override it in `.dev.vars` with `http://localhost:8787/mcp`. `import { env } from "cloudflare:workers"` exposes vars at module scope (<https://developers.cloudflare.com/workers/runtime-apis/bindings/index.md>).
- Pick one public hostname. A token minted for `https://mcp.example.com/mcp` fails on the `*.workers.dev` URL. On any origin other than `resource`'s, the 401 carries no `resource_metadata` and PRM is not served, so clients cannot discover the AS. Run `wrangler dev` on the exact port in `.dev.vars` (8787). Set `"workers_dev": false` once a custom domain serves the resource.
- Every `apiRoute` must be the resource path or a path-boundary descendant (`/mcp` covers `/mcp/x`, not `/mcp-x`), else construction throws.
- `resourceMatchOriginOnly` is removed in 1.0 and throws if passed.
- `apiRoute: "/mcp"` + `apiHandler`, or `apiHandlers: { "/mcp": h }`. Never both.
- `apiHandler` gets requests with a valid token only. The provider answers everything else on `apiRoute` with 401 and, on the `resource` origin, `WWW-Authenticate: Bearer ... resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`.
- `defaultHandler` receives all other paths and owns `authorizeEndpoint` and any upstream `/callback`. The provider owns `tokenEndpoint`, `clientRegistrationEndpoint`, and both `/.well-known/` metadata documents.
- The provider checks handlers at construction. Passing the callable agents handler throws `TypeError: apiHandler must be either an ExportedHandler object with a fetch method or a class extending WorkerEntrypoint` at startup, so wrap it as section 5 does.
- KV binding must be named `OAUTH_KV`. The name is hard-coded.
- The provider injects `env.OAUTH_PROVIDER` (`OAuthHelpers`). `wrangler types` cannot see it, so declare it yourself (section 5 `env.d.ts`).
- Client registration: prefer CIMD (Client ID Metadata Documents). It needs both `clientIdMetadataDocumentEnabled: true` and the compat flag `global_fetch_strictly_public`. Metadata advertises `client_id_metadata_document_supported: true` only when both are set. That flag has no default-on date, so set it explicitly.
- DCR (`clientRegistrationEndpoint`) is deprecated by MCP 2026-07-28. Keep it as a fallback for clients without CIMD.
- `userId` in `completeAuthorization()` must not contain `:`. Use the upstream numeric id or a hash.
- `completeAuthorization()` revokes the user's earlier grants for the same client and resource by default.
- `props` are AES-GCM encrypted in KV. Grant `userId` and `metadata` are stored in plaintext. Put upstream tokens in `props`, never in `metadata`.
- With `not_found_handling: "single-page-application"`, or asset files that could match these paths, list the auth paths in `assets.run_worker_first` (`["/mcp", "/authorize", "/callback", "/oauth/*", "/.well-known/*"]`) or the assets layer swallows them.
- Expired rows: keep the provider in a `const` and call `provider.purgeExpiredData(env, { batchSize })` from a `scheduled` handler on a Cron Trigger (provider `docs/advanced-configuration.md`).

## 3. Reading identity inside tools

`OAuthProvider` sets `ctx.props` (your `completeAuthorization` props) and `ctx.auth` (`{ token, audience, expiresAt?, scope, userId?, clientId? }`) on the execution context. It does not populate SDK `context.http.authInfo`.

| Read | Works under `OAuthProvider`? |
| --- | --- |
| `getMcpAuthContext()?.props` (from `agents/mcp/server`) | Yes. Typed `Record<string, unknown>`: cast to your `Props` |
| `context.http?.authInfo` in a tool | No, `undefined`. Cloudflare's handler-api page and the `examples/mcp-worker-authenticated` `whoami` tool describe a provider contract no released provider implements |
| `ctx.auth.scope`, `ctx.auth.clientId` | Only in the `apiHandler` wrapper, not in tools |

This table was observed at runtime with a handler that sets `ctx` exactly as provider 1.1.0 does, in legacy and 2026-07-28 eras.
If a tool needs scopes or the client id, enforce them in the wrapper (section 4) or copy them into `props` at `completeAuthorization`.
Do not set the internal `Symbol.for("cloudflare.workers-oauth-provider.verified-context.v1")` on `ctx` to make `authInfo` appear. It is an undocumented cross-package contract.

## 4. Scopes

- `scopesSupported` is the AS catalogue (RFC 8414). List `offline_access` here. MCP clients may request it only when the AS lists it (MCP 2026-07-28 authorization), and Claude does. Access tokens last 3600 s by default (`accessTokenTTL`).
- `resourceMetadata.scopes_supported` is the resource baseline, published in PRM and the 401 challenge. Never list `offline_access` there.
- `requiredScopes` exists only on provider main (unreleased 1.2.0). On 1.1.0 it is not an option. When 1.2.0 ships, move the baseline to `requiredScopes`. Setting both throws there. Check the installed version is 1.2.0 or later (`pnpm list @cloudflare/workers-oauth-provider`). A grep for `requiredScopes` in the 1.1.0 `.d.ts` also matches `ExternalTokenError`, so it cannot tell the versions apart.
- Both lists only advertise. Nothing enforces a scope until your wrapper checks `ctx.auth.scope`.
- Answer a missing scope with `insufficientScope(ctx.auth, [...])`. It returns 403 with `WWW-Authenticate: Bearer error="insufficient_scope", scope=..., resource_metadata=...`, which drives client step-up. Name every scope the operation needs in one challenge.
- Per-tool scopes: read `Mcp-Name` in the wrapper. 2026-07-28 requests carry it and the handler rejects a header that disagrees with the body. Legacy-era requests do not carry it. When `Mcp-Method` is absent, read `method` and `params?.name` from `await req.clone().json()`, and deny a `tools/call` whose name you cannot read.
- `approveConsent(..., { scope })` accepts only scopes in `scopesSupported`. The consent page may grant more or fewer than the client asked for.

## 5. Complete example: GitHub upstream

The Worker is the AS for MCP clients and a client of GitHub. Consent happens before the GitHub redirect (section 7). The GitHub token stays in encrypted `props`. Typechecked against provider 1.1.0 types with `tsc` strict.

`wrangler.jsonc`:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "mcp-github",
  "main": "src/index.ts",
  "compatibility_date": "YYYY-MM-DD", // the day you create the project
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "kv_namespaces": [{ "binding": "OAUTH_KV", "id": "<kv-namespace-id>" }],
  "ratelimits": [{ "name": "MCP_RATE_LIMITER", "namespace_id": "1001", "simple": { "limit": 100, "period": 60 } }],
  "vars": { "MCP_RESOURCE": "https://mcp.example.com/mcp" },
  "observability": { "enabled": true }
}
```

Secrets: `pnpm wrangler secret put GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Locally, `.dev.vars` holds them plus `MCP_RESOURCE=http://localhost:8787/mcp`; then run `pnpm wrangler types`.
Register a GitHub OAuth app with callback `https://mcp.example.com/callback`, and a separate dev app for `http://localhost:8787/callback`.

`src/env.d.ts`:

```ts
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    OAUTH_PROVIDER: OAuthHelpers; // injected by OAuthProvider, not a wrangler binding
  }
}
```

`src/server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";

export type Props = { login: string; githubToken: string };

export function createServer() {
  const server = new McpServer({ name: "github-mcp", version: "1.0.0" });
  server.registerTool("whoami", { description: "The signed-in GitHub user" }, async () => {
    const props = getMcpAuthContext()?.props as Props | undefined;
    if (!props) return { isError: true, content: [{ type: "text", text: "Not signed in" }] };
    // The upstream token from props, never the MCP bearer token.
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${props.githubToken}`, "User-Agent": "github-mcp" },
    });
    return { content: [{ type: "text", text: await res.text() }] };
  });
  return server;
}
```

`src/index.ts`:

```ts
import { OAuthProvider, insufficientScope, type OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { github } from "./github";
import { createServer, type Props } from "./server";

const mcp = createMcpHandler(createServer); // module scope: built once

const apiHandler = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const { auth } = ctx as OAuthResourceContext<Props>; // set by OAuthProvider for valid tokens
    if (!auth.scope.includes("mcp:read")) return insufficientScope(auth, ["mcp:read"]);
    const key = `${auth.userId}:${req.headers.get("Mcp-Name") ?? "-"}`;
    const { success } = await env.MCP_RATE_LIMITER.limit({ key });
    if (!success) return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
    return mcp(req, env, ctx);
  },
};

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler,
  defaultHandler: github,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register", // DCR fallback for clients without CIMD
  clientIdMetadataDocumentEnabled: true, // also needs the global_fetch_strictly_public flag
  scopesSupported: ["mcp:read", "offline_access"], // AS catalogue
  resourceMetadata: {
    resource: env.MCP_RESOURCE, // exact public URL incl. /mcp; http only on loopback
    scopes_supported: ["mcp:read"], // PRM baseline; never offline_access here
  },
});
```

`src/github.ts`:

```ts
import { AuthorizationError, type AuthRequest, type ClientInfo } from "@cloudflare/workers-oauth-provider";
import type { Props } from "./server";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function consentPage(client: ClientInfo | null, req: AuthRequest, handle: string) {
  const name = esc(client?.clientName ?? req.clientId);
  // CIMD client_id is an https URL the provider fetched; a DCR name is self-asserted.
  const who = req.clientId.startsWith("https://")
    ? `from <strong>${esc(new URL(req.clientId).hostname)}</strong>`
    : "(name supplied by the app, not verified)";
  const host = esc(new URL(req.redirectUri).hostname);
  const scopes = (req.scope.length ? req.scope : ["mcp:read"])
    .map((s) => `<label><input type="checkbox" name="scope" value="${esc(s)}" checked> ${esc(s)}</label>`)
    .join("<br>");
  return `<!doctype html><meta charset="utf-8"><title>Authorize ${name}</title>
<h1>Allow ${name} to use your GitHub account?</h1>
<p>Client ${who}.</p>
<p>Access will be sent to <strong>${host}</strong>.${/^(localhost|127(\.\d+){3}|\[::1\])$/.test(host) ? " This is an app on your computer: continue only if you just started signing in from it." : ""}</p>
<form method="post"><input type="hidden" name="handle" value="${esc(handle)}">${scopes}
<p><button name="decision" value="approve">Allow</button> <button name="decision" value="deny">Deny</button></p></form>`;
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const oauth = env.OAUTH_PROVIDER;

  if (url.pathname === "/authorize" && req.method === "GET") {
    const authReq = await oauth.parseAuthRequest(req);
    const consent = await oauth.beginConsent(authReq); // __Host- binding cookie + frame-ancestors 'none'
    consent.headers.set("Content-Type", "text/html; charset=utf-8");
    const client = await oauth.lookupClient(authReq.clientId);
    return new Response(consentPage(client, authReq, consent.handle), { headers: consent.headers });
  }

  if (url.pathname === "/authorize" && req.method === "POST") {
    const form = await req.formData();
    const handle = String(form.get("handle"));
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(req, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(req, handle, { scope: form.getAll("scope").map(String) });
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const { state, headers } = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers });
    const gh = new URL("https://github.com/login/oauth/authorize");
    gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    gh.searchParams.set("redirect_uri", `${url.origin}/callback`);
    gh.searchParams.set("scope", "read:user");
    gh.searchParams.set("state", state);
    gh.searchParams.set("code_challenge", b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    gh.searchParams.set("code_challenge_method", "S256");
    headers.set("Location", gh.href);
    return new Response(null, { status: 302, headers });
  }

  if (url.pathname === "/callback") {
    const { request: original, data, headers } = await oauth.finishUpstream<{ verifier: string }>(req);
    const code = url.searchParams.get("code");
    if (!code) {
      const back = new URL(original.redirectUri);
      back.searchParams.set("error", "access_denied");
      back.searchParams.set("state", original.state);
      if (original.issuer) back.searchParams.set("iss", original.issuer);
      headers.set("Location", back.href);
      return new Response(null, { status: 302, headers });
    }
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/callback`,
        code_verifier: data.verifier,
      }),
    });
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) return new Response("GitHub sign-in failed", { status: 502 });
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${access_token}`, "User-Agent": "github-mcp" },
    });
    const user = (await userRes.json()) as { id: number; login: string };
    const props: Props = { login: user.login, githubToken: access_token };
    const { redirectTo } = await oauth.completeAuthorization({
      request: original,
      userId: String(user.id), // must not contain ":"
      metadata: {},
      scope: original.scope,
      props,
    });
    headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers });
  }

  return new Response("Not found", { status: 404 });
}

export const github = {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (e) {
      if (e instanceof AuthorizationError && e.redirectUri) {
        const back = new URL(e.redirectUri);
        back.searchParams.set("error", e.code);
        back.searchParams.set("error_description", e.description);
        if (e.state) back.searchParams.set("state", e.state);
        if (e.issuer) back.searchParams.set("iss", e.issuer);
        return Response.redirect(back.href, 302);
      }
      if (e instanceof AuthorizationError) return new Response(esc(e.description), { status: 400 });
      throw e;
    }
  },
} satisfies ExportedHandler<Env>;
```

Notes on the example:

- `approved.request` and `finishUpstream().request` come from server-side storage. Never rebuild the auth request from form fields or from `state`.
- `beginUpstream()` does not check consent. Call it only after `approveConsent()`, or after `isConsentRemembered()` returns true.
- To skip the page for returning users, pass `remember: { secret: env.CONSENT_SECRET }` (32+ chars, a Worker secret) to `approveConsent()` and check `isConsentRemembered(req, authReq, { secret })` first. Provider `docs/consent-page.md` covers it.
- A `CimdFetchError` from `parseAuthRequest()` or `lookupClient()` means the client's metadata document could not be fetched. Render it locally, never redirect.
- For upstream tokens that expire, store the refresh token in `props` and refresh in `tokenExchangeCallback`. Throw `new OAuthError("invalid_grant", ...)` when the upstream refresh is dead so the grant is revoked. Throw `temporarily_unavailable` for a transient failure. Provider `docs/upstream-sign-in.md` has the code.

GitHub PKCE (`code_challenge`, S256) is documented at <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps>.
Provider guides at the release tag: <https://github.com/cloudflare/workers-oauth-provider/tree/v1.1.0/docs>.

## 6. Your own validator: Cloudflare Access or a third-party AS

When something else issues the tokens, verify them in front of the handler and pass the result with `mcp.fetch(req, { authInfo })`. Tools then read `context.http?.authInfo` (verified at runtime). This path takes no `ctx`, so `getMcpAuthContext()` returns `undefined` here.

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

function createServer() {
  const server = new McpServer({ name: "access-mcp", version: "1.0.0" });
  server.registerTool("whoami", { description: "Signed-in user" }, async (context) => ({
    content: [{ type: "text", text: String(context.http?.authInfo?.extra?.email ?? "unknown") }],
  }));
  return server;
}

const mcp = createMcpHandler(createServer, { allowedHostnames: ["mcp.example.com", "localhost", "127.0.0.1"] }); // replaces the defaults
const TEAM = "https://myteam.cloudflareaccess.com";
const JWKS = createRemoteJWKSet(new URL(`${TEAM}/cdn-cgi/access/certs`));

export default {
  async fetch(req: Request, env: { POLICY_AUD: string }) {
    const jwt = req.headers.get("Cf-Access-Jwt-Assertion");
    if (!jwt) return new Response("Forbidden", { status: 403 });
    try {
      const { payload } = await jwtVerify(jwt, JWKS, { issuer: TEAM, audience: env.POLICY_AUD });
      return mcp.fetch(req, {
        authInfo: { token: jwt, clientId: "cf-access", scopes: [], extra: { email: payload.email, sub: payload.sub } },
      });
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
  },
} satisfies ExportedHandler<{ POLICY_AUD: string }>;
```

- Cloudflare Access with Managed OAuth: Access answers the 401, hosts discovery and runs the OAuth flow. The Worker must still validate the Access JWT. Cloudflare: "Only enable Managed OAuth for MCP servers that validate the Access JWT sent by Cloudflare". Managed OAuth is opt-in per self-hosted application. Docs: <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/index.md> and <https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/index.md>.
- Managed OAuth, observed 2026-09-29 with Worker-level Access on `*.workers.dev` and a claude.ai web custom connector:
  - The 401 carries `resource_metadata="https://<host>/.well-known/cloudflare-access-protected-resource/mcp"`. That document and `/.well-known/oauth-protected-resource/mcp` both give `resource` as the exact `/mcp` URL.
  - The AS is `https://<team>.cloudflareaccess.com`: DCR, S256 and the `none` auth method, but no CIMD, so Claude registers with DCR.
  - Add `https://claude.ai/api/mcp/auth_callback` to the app's allowed redirect URIs, and allow localhost clients for Claude Code.
  - The claude.ai web connector connected and every request carried the user. Public reports of it failing exist (anthropics/claude-ai-mcp#410, #992).
- Identity without `jose`: `(await ctx.access?.getIdentity())?.email` was set on Managed OAuth bearer requests (observed). Pass it with a handler built per request, `createMcpHandler(createServer, { authContext: { props: { email } } })`, and read it in tools with `getMcpAuthContext()`. Return 403 when it is missing, so turning Access off closes the server. Whether `ctx.access` satisfies Cloudflare's "validate the Access JWT" requirement is unverified. The `jose` snippet above is the documented path.
- On a custom domain, set `"workers_dev": false`. Access guards only the hostname it is configured on.
- The `remote-mcp-cf-access-self-hosted` template verifies the JWT but never hands the identity to tools. The `authInfo` pass above fixes that.
- Access for SaaS as an OIDC upstream behind `OAuthProvider` follows section 5 with Access endpoints in place of GitHub (template `remote-mcp-cf-access`).
- Third-party AS (Auth0, WorkOS and others) issuing JWTs: verify `iss`, `aud` equal to your resource URL, and `exp` in the same wrapper. You must also serve PRM at `/.well-known/oauth-protected-resource/mcp` and a 401 challenge yourself. `OAuthResourceServer` with a custom `validateToken` does both (provider `docs/resource-servers.md`, "at your own risk" for non-provider validators).
- Opaque third-party tokens in front of `OAuthProvider`: `resolveExternalToken` returns `{ props, audience }`. `audience` is required and must match `resource`.

## 7. Security checklist

Token handling:

- Never forward the MCP client's bearer token to an upstream API (token passthrough ban). Call upstreams with the upstream token from `props`.
- Never accept a token minted for another resource. The provider enforces audience. A custom validator must check `aud` itself.
- Never log `ctx.auth.token`, `authInfo.token` or `props`.
- Tokens come only from the `Authorization: Bearer` header, never a query string.

Consent page (the 1.1.0 helpers handle the cookie, framing and state parts):

- Consent per MCP client before any upstream redirect. Your GitHub OAuth app is shared by every MCP client, which makes the Worker a confused deputy without it.
- Show the client name, the scopes, and the redirect URI hostname. Warn when that host is loopback. For a CIMD client show its `client_id` domain. A DCR client's name is self-asserted.
- HTML-escape `clientName`, `clientUri`, `logoUri` and scope strings. An attacker chooses them.
- Send `beginConsent()`'s `headers` with the page.
- Never use `btoa(JSON.stringify(oauthReq))` as upstream state: it is forgeable and skips consent.
- `__Host-` cookies matter on `*.workers.dev`: other subdomains can otherwise set cookies for yours. Custom cookies need the prefix too. `cookiePrefix` must start with `__Host-`.
- Redirect to the client only for an `AuthorizationError` that carries `redirectUri`. Render every other error locally.

## 8. Claude and ChatGPT connector requirements

Claude (<https://claude.com/docs/connectors/building/authentication.md>, fetched 2026-09-28):

- Unauthenticated `/mcp` must return 401 with `WWW-Authenticate: Bearer resource_metadata="..."`. A 200 means Claude treats the server as authless.
- PRM `resource` must equal the URL the user types, path included. Only the first `authorization_servers` entry is used.
- Claude uses CIMD only when AS metadata has `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`. Provider 1.1.0 advertises `none`, so the two CIMD settings in section 2 are enough. Otherwise Claude falls back to DCR.
- Redirect URIs to allow if you restrict clients (`clientRegistrationCallback` or pre-registered clients): `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, and Claude Code loopback `http://localhost:<any>/callback` and `http://127.0.0.1:<any>/callback`. Claude Code's CIMD `client_id` is `https://claude.ai/oauth/claude-code-client-metadata`.
- Claude requests `offline_access` when AS `scopesSupported` lists it. It refreshes on 401 and up to 5 minutes before expiry. The token endpoint must accept `application/x-www-form-urlencoded` (the provider does).
- Timeouts: 10 s for discovery, registration and token; 30 s for refresh. Keep `/authorize` upstream calls fast. Claude egress range: `160.79.104.0/21`.
- Protocol era support for Claude and ChatGPT: [spec.md](spec.md).

ChatGPT (<https://developers.openai.com/plugins/build/auth>, fetched 2026-09-28):

- PRM with `resource` echoed through the flow. Add no root `/.well-known/oauth-protected-resource` route: the provider serves the path-aware form and the 401 `resource_metadata` pointer names it.
- Client preference: static credentials, then CIMD, then DCR. The provider implements only `none` for CIMD, which ChatGPT accepts.
- Redirect URIs: `https://chatgpt.com/connector_platform_oauth_redirect` and `https://chatgpt.com/connector/oauth/{callback_id}`.
- The AS must return `iss` on the authorization response and advertise `authorization_response_iss_parameter_supported: true`. The provider does both. Custom error redirects must keep `iss`, as section 5 does.

## 9. Rate limiting per user and tool

- Rate-limit inside `apiHandler`, after the provider validated the token, keyed on `ctx.auth.userId` plus the tool name (section 5).
- Binding config, the `Mcp-Name` key, legacy buckets and the 429 response: [testing-deploy.md](testing-deploy.md), rate limiting.
- The token and registration endpoints sit outside `apiHandler`. To limit them, wrap the provider's `fetch` and key on `CF-Connecting-IP`.

## 10. What was not verified

- The full OAuth round trip (browser consent, GitHub, code exchange, token, authorised MCP call) was not run end to end on provider 1.1.0. 1.1.0 was inside the 4-day pnpm quarantine on 2026-09-28. The section 5 code ran under `wrangler dev` with 1.1.0 aliased in only as far as startup, the 401 challenge and PRM. The section 5 and 6 code was otherwise typechecked: strict `tsc` against the 1.1.0 `.d.ts`, `agents` 0.24.0, `@modelcontextprotocol/server` 2.0.0, `jose` 6.2.12 and `wrangler types` output.
- The section 3 table was observed at runtime with a probe that mimics the provider's `ctx`, not with the provider itself.
- ChatGPT following the 401 `resource_metadata` pointer to the path-aware PRM, and ChatGPT's handling of `offline_access`.
- Access Managed OAuth: token refresh after the 15-minute Access token, Cowork and Claude Code were not exercised. The section 6 `jose` snippet is typechecked only.
