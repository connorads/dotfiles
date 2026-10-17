export type ExecutorConfig = { url: URL; token: string };

export type ConfigResult =
  | { ok: true; config: ExecutorConfig }
  | { ok: false; message: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseConfig(raw: { url: string; token: string }): ConfigResult {
  const url = URL.parse(raw.url.trim());
  if (!url) {
    return { ok: false, message: "Set `url` to your Executor MCP endpoint, e.g. https://mcp.executor.sh/mcp." };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    return { ok: false, message: "`url` must use https (http is allowed only for localhost)." };
  }
  // The MCP auth spec forbids credentials in the query string.
  if (url.username || url.password || url.searchParams.has("token")) {
    return { ok: false, message: "Put the token in the `token` setting, not in `url`." };
  }
  const token = raw.token.trim();
  if (!token) {
    return { ok: false, message: "Set `token` to an Executor API key for your organization." };
  }
  return { ok: true, config: { url, token } };
}
