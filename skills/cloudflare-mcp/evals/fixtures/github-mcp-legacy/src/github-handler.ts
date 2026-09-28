import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { Octokit } from "octokit";
import type { Props } from "./index";
import { approvedClientCookie, fetchUpstreamAuthToken, getApprovedClients, getUpstreamAuthorizeUrl } from "./utils";

const app = new Hono<{ Bindings: Env }>();

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function redirectToGitHub(c: { req: { url: string }; env: Env }, oauthReq: AuthRequest, headers: HeadersInit = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        upstream_url: "https://github.com/login/oauth/authorize",
        client_id: c.env.GITHUB_CLIENT_ID,
        scope: "read:user user:email",
        redirect_uri: new URL("/callback", c.req.url).href,
        state: btoa(JSON.stringify(oauthReq)),
      }),
    },
  });
}

// Step 1: MCP client sends the user here. Show a consent screen unless already approved.
app.get("/authorize", async (c) => {
  const oauthReq = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  if (!oauthReq.clientId) return c.text("Invalid request", 400);

  const approved = await getApprovedClients(c.req.header("Cookie") ?? null, c.env.COOKIE_ENCRYPTION_KEY);
  if (approved.includes(oauthReq.clientId)) return redirectToGitHub(c, oauthReq);

  const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
  const name = escapeHtml(client?.clientName ?? oauthReq.clientId);
  const state = escapeHtml(btoa(JSON.stringify(oauthReq)));
  return c.html(`<!doctype html><html><head><title>Authorize ${name}</title></head>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto">
<h1>Authorize access</h1>
<p><strong>${name}</strong> wants to use this MCP server with your GitHub identity.</p>
<form method="post" action="/authorize">
<input type="hidden" name="state" value="${state}">
<button type="submit">Approve and continue to GitHub</button>
</form></body></html>`);
});

// Step 2: user approved the client; remember it and go to GitHub.
app.post("/authorize", async (c) => {
  const form = await c.req.formData();
  const state = form.get("state");
  if (typeof state !== "string") return c.text("Missing state", 400);
  const oauthReq = JSON.parse(atob(state)) as AuthRequest;
  if (!oauthReq.clientId) return c.text("Invalid state", 400);

  const approved = await getApprovedClients(c.req.header("Cookie") ?? null, c.env.COOKIE_ENCRYPTION_KEY);
  const cookie = await approvedClientCookie(approved, oauthReq.clientId, c.env.COOKIE_ENCRYPTION_KEY);
  return redirectToGitHub(c, oauthReq, { "Set-Cookie": cookie });
});

// Step 3: GitHub redirects back; exchange code, look up user, issue our own token to the MCP client.
app.get("/callback", async (c) => {
  const stateParam = c.req.query("state");
  if (!stateParam) return c.text("Missing state", 400);
  const oauthReq = JSON.parse(atob(stateParam)) as AuthRequest;
  if (!oauthReq.clientId) return c.text("Invalid state", 400);

  const [accessToken, errResponse] = await fetchUpstreamAuthToken({
    upstream_url: "https://github.com/login/oauth/access_token",
    client_id: c.env.GITHUB_CLIENT_ID,
    client_secret: c.env.GITHUB_CLIENT_SECRET,
    code: c.req.query("code"),
    redirect_uri: new URL("/callback", c.req.url).href,
  });
  if (errResponse) return errResponse;

  const user = await new Octokit({ auth: accessToken }).rest.users.getAuthenticated();
  const { login, name, email } = user.data;

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: login,
    metadata: { label: name ?? login },
    scope: oauthReq.scope,
    props: { login, name: name ?? login, email: email ?? "", accessToken } satisfies Props,
  });
  return Response.redirect(redirectTo, 302);
});

export { app as GitHubHandler };
