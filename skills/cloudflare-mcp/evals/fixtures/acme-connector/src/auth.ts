import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import type { Props } from "./server";

// /authorize sits behind Cloudflare Access, which sets the verified email header.
const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

app.get("/authorize", async (c) => {
  const email = c.req.header("cf-access-authenticated-user-email");
  if (!email) return c.text("Sign in through Acme SSO first", 401);
  const oauthReq = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: email,
    metadata: { label: email },
    scope: oauthReq.scope,
    props: { email } satisfies Props,
  });
  return c.redirect(redirectTo, 302);
});

export const authHandler = { fetch: (r: Request, e: Env, c: ExecutionContext) => app.fetch(r, e, c) };
