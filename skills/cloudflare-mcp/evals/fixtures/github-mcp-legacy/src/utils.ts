export function getUpstreamAuthorizeUrl(opts: {
  upstream_url: string;
  client_id: string;
  scope: string;
  redirect_uri: string;
  state?: string;
}): string {
  const u = new URL(opts.upstream_url);
  u.searchParams.set("client_id", opts.client_id);
  u.searchParams.set("redirect_uri", opts.redirect_uri);
  u.searchParams.set("scope", opts.scope);
  if (opts.state) u.searchParams.set("state", opts.state);
  u.searchParams.set("response_type", "code");
  return u.href;
}

export async function fetchUpstreamAuthToken(opts: {
  upstream_url: string;
  client_id: string;
  client_secret: string;
  code: string | undefined;
  redirect_uri: string;
}): Promise<[string, null] | [null, Response]> {
  if (!opts.code) return [null, new Response("Missing code", { status: 400 })];
  const resp = await fetch(opts.upstream_url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: opts.client_id,
      client_secret: opts.client_secret,
      code: opts.code,
      redirect_uri: opts.redirect_uri,
    }).toString(),
  });
  if (!resp.ok) return [null, new Response("Failed to fetch access token", { status: 500 })];
  const body = (await resp.json()) as { access_token?: string; error?: string };
  if (!body.access_token) return [null, new Response(`Missing access token: ${body.error ?? ""}`, { status: 400 })];
  return [body.access_token, null];
}

// --- Signed cookie of client IDs the user has already approved ---

const COOKIE = "mcp-approved-clients";

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);

export async function getApprovedClients(cookieHeader: string | null, secret: string): Promise<string[]> {
  const raw = cookieHeader?.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return [];
  const [sig, b64] = raw.slice(COOKIE.length + 1).split(".");
  if (!sig || !b64) return [];
  const payload = atob(b64);
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromHex(sig), new TextEncoder().encode(payload));
  if (!ok) return [];
  try {
    const list = JSON.parse(payload);
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function approvedClientCookie(existing: string[], clientId: string, secret: string): Promise<string> {
  const payload = JSON.stringify([...new Set([...existing, clientId])]);
  const sig = toHex(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload)));
  return `${COOKIE}=${sig}.${btoa(payload)}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`;
}
