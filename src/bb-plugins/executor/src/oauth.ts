import { z } from "zod";

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export const SCOPE = "mcp offline_access";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export type Endpoints = {
  issuer: string;
  resource: string;
  token: string;
  registration: string;
  device: string;
  revocation: string | undefined;
};

export type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };

export type DeviceStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | undefined;
  expiresAt: number;
  intervalSeconds: number;
};

/** `kind` decides what the UI offers: retry, sign in again, or nothing. */
export class OAuthError extends Error {
  readonly kind: "discovery" | "registration" | "denied" | "expired" | "invalid-grant" | "network";

  constructor(kind: OAuthError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

const ProtectedResource = z.object({ resource: z.string(), authorization_servers: z.array(z.string()).min(1) });
const ServerMetadata = z.object({
  issuer: z.string(),
  token_endpoint: z.url(),
  registration_endpoint: z.url(),
  device_authorization_endpoint: z.url().optional(),
  revocation_endpoint: z.url().optional(),
});
const Registered = z.object({ client_id: z.string().min(1) });
const DeviceResponse = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.url(),
  verification_uri_complete: z.url().optional(),
  expires_in: z.number(),
  interval: z.number().optional(),
});
const TokenResponse = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number() });
const TokenError = z.object({ error: z.string() });

/**
 * RFC 9728 then RFC 8414: the resource names its issuer, and the issuer's
 * origin serves the endpoints. Both identities must match exactly, so a
 * hostile metadata document cannot redirect the sign-in.
 */
export async function discover(resource: URL, fetch: FetchLike): Promise<Endpoints> {
  const metadataUrl = `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}${resource.search}`;
  const protectedResource = await getJson(fetch, metadataUrl, ProtectedResource, "discovery");
  if (protectedResource.resource !== resource.href) {
    throw new OAuthError("discovery", `Executor names a different resource: ${protectedResource.resource}`);
  }
  const issuer = protectedResource.authorization_servers[0]!;
  const issuerUrl = new URL(issuer);
  const serverUrl = `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname.replace(/\/$/, "")}`;
  const metadata = await getJson(fetch, serverUrl, ServerMetadata, "discovery");
  if (metadata.issuer !== issuer) throw new OAuthError("discovery", "Authorization server issuer does not match.");
  if (!metadata.device_authorization_endpoint) {
    throw new OAuthError("discovery", "This Executor does not offer device sign-in.");
  }
  return {
    issuer,
    resource: protectedResource.resource,
    token: metadata.token_endpoint,
    registration: metadata.registration_endpoint,
    device: metadata.device_authorization_endpoint,
    revocation: metadata.revocation_endpoint,
  };
}

/** A public client: no secret, so nothing beyond the grant itself needs protecting. */
export async function registerClient(endpoints: Endpoints, fetch: FetchLike): Promise<string> {
  const body = JSON.stringify({
    client_name: "BB Executor plugin",
    token_endpoint_auth_method: "none",
    grant_types: [DEVICE_GRANT, "refresh_token"],
    response_types: [],
    scope: SCOPE,
  });
  const registered = await postJson(fetch, endpoints.registration, { body, contentType: "application/json", schema: Registered, kind: "registration" });
  return registered.client_id;
}

export async function startDevice(endpoints: Endpoints, clientId: string, fetch: FetchLike, now = Date.now()): Promise<DeviceStart> {
  const form = new URLSearchParams({ client_id: clientId, scope: SCOPE, resource: endpoints.resource });
  const started = await postJson(fetch, endpoints.device, { body: form, schema: DeviceResponse, kind: "registration" });
  return {
    deviceCode: started.device_code,
    userCode: started.user_code,
    verificationUri: started.verification_uri,
    verificationUriComplete: started.verification_uri_complete,
    expiresAt: now + started.expires_in * 1000,
    intervalSeconds: started.interval ?? 5,
  };
}

/** RFC 8628 polling: wait the interval, slow down when asked, stop on approval, denial or expiry. */
export async function pollDevice(
  endpoints: Endpoints,
  clientId: string,
  start: DeviceStart,
  options: { fetch: FetchLike; signal: AbortSignal; sleep?: (ms: number, signal: AbortSignal) => Promise<void>; now?: () => number },
): Promise<Tokens> {
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? Date.now;
  let interval = start.intervalSeconds;
  for (;;) {
    await sleep(interval * 1000, options.signal);
    if (now() >= start.expiresAt) throw new OAuthError("expired", "The sign-in code expired. Start again.");
    const form = new URLSearchParams({ grant_type: DEVICE_GRANT, device_code: start.deviceCode, client_id: clientId });
    const response = await send(options.fetch, endpoints.token, { method: "POST", body: form, signal: options.signal });
    if (response.ok) return toTokens(await parse(response, TokenResponse, "network"), now());
    if (response.status === 429) {
      interval += 5;
      continue;
    }
    const { error } = await parse(response, TokenError, "network");
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      interval += 5;
      continue;
    }
    if (error === "access_denied") throw new OAuthError("denied", "Sign-in was declined in Executor.");
    if (error === "expired_token") throw new OAuthError("expired", "The sign-in code expired. Start again.");
    throw new OAuthError("network", `Executor refused the sign-in: ${error}`);
  }
}

/** Refresh tokens rotate: the caller must persist the new one before any other refresh. */
export async function refresh(
  endpoints: Endpoints,
  grant: { clientId: string; refreshToken: string },
  fetch: FetchLike,
  now = Date.now(),
): Promise<Tokens> {
  const form = new URLSearchParams({ grant_type: "refresh_token", client_id: grant.clientId, refresh_token: grant.refreshToken });
  const response = await send(fetch, endpoints.token, { method: "POST", body: form });
  if (response.ok) return toTokens(await parse(response, TokenResponse, "network"), now);
  const parsed = TokenError.safeParse(await response.json().catch(() => null));
  if (parsed.success && parsed.data.error === "invalid_grant") {
    throw new OAuthError("invalid-grant", "Executor ended this sign-in. Sign in again.");
  }
  throw new OAuthError("network", `Token refresh failed (HTTP ${response.status}).`);
}

/** Best effort: the grant also dies when Executor revokes the connection. */
export async function revoke(endpoints: Endpoints, clientId: string, refreshToken: string, fetch: FetchLike): Promise<void> {
  if (!endpoints.revocation) return;
  const form = new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token", client_id: clientId });
  await send(fetch, endpoints.revocation, { method: "POST", body: form }).catch(() => undefined);
}

function toTokens(token: z.infer<typeof TokenResponse>, now: number): Tokens {
  return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: now + token.expires_in * 1000 };
}

async function getJson<T>(fetch: FetchLike, url: string, schema: z.ZodType<T>, kind: OAuthError["kind"]): Promise<T> {
  const response = await send(fetch, url, { method: "GET" });
  if (!response.ok) throw new OAuthError(kind, `${url} answered HTTP ${response.status}.`);
  return parse(response, schema, kind);
}

async function postJson<T>(
  fetch: FetchLike,
  url: string,
  request: { body: string | URLSearchParams; contentType?: string; schema: z.ZodType<T>; kind: OAuthError["kind"] },
): Promise<T> {
  const headers = request.contentType ? { "content-type": request.contentType } : undefined;
  const response = await send(fetch, url, { method: "POST", body: request.body, ...(headers ? { headers } : {}) });
  if (!response.ok) throw new OAuthError(request.kind, `${new URL(url).pathname} answered HTTP ${response.status}.`);
  return parse(response, request.schema, request.kind);
}

/** Redirects are refused so a token request never follows a server to another host. */
async function send(fetch: FetchLike, url: string, init: RequestInit): Promise<Response> {
  try {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    return await fetch(url, { ...init, redirect: "error", headers });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new OAuthError("network", `Could not reach ${new URL(url).origin}.`);
  }
}

async function parse<T>(response: Response, schema: z.ZodType<T>, kind: OAuthError["kind"]): Promise<T> {
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new OAuthError(kind, `Unexpected response from ${new URL(response.url || "http://x").pathname}.`);
  return parsed.data;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
