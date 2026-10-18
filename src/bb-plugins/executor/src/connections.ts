import { z } from "zod";

export const ConnectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(60),
  url: z.url(),
});
export type Connection = z.infer<typeof ConnectionSchema>;

/** A thread follows the default, names one connection, or turns Executor off. */
export type ThreadChoice = { kind: "default" } | { kind: "connection"; id: string } | { kind: "off" };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Accepts the URL from Executor's Connect page. Keeps only `connection`, so
 * the URL matches the resource Executor binds the grant to. Other approval
 * modes are refused because this plugin advertises no elicitation support.
 */
export function parseConnectionUrl(raw: string): { ok: true; url: URL } | { ok: false; message: string } {
  const url = URL.parse(raw.trim());
  if (!url) return { ok: false, message: "Paste the MCP URL from Executor's Connect page." };
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    return { ok: false, message: "The URL must use https." };
  }
  if (!/^\/(org\/[^/]+\/)?mcp$/.test(url.pathname)) {
    return { ok: false, message: "That is not an Executor MCP URL. It ends in /mcp." };
  }
  if (url.username || url.password) return { ok: false, message: "The URL must not contain credentials." };
  const mode = url.searchParams.get("elicitation_mode");
  if (mode && mode !== "model") {
    return { ok: false, message: "Use a connection with the default approval mode, not native or browser." };
  }
  const connection = url.searchParams.get("connection");
  url.search = "";
  if (connection) url.searchParams.set("connection", connection);
  url.hash = "";
  return { ok: true, url };
}

export function slugFor(name: string, taken: ReadonlySet<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "connection";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** The connection a thread uses: its own choice while that exists, else the default. */
export function resolveChoice(
  choice: ThreadChoice,
  defaultId: string | null,
  connections: readonly Connection[],
): { kind: "connection"; connection: Connection } | { kind: "off" } | { kind: "unset" } {
  if (choice.kind === "off") return { kind: "off" };
  const chosen = choice.kind === "connection" ? connections.find((c) => c.id === choice.id) : undefined;
  const connection = chosen ?? connections.find((c) => c.id === defaultId);
  return connection ? { kind: "connection", connection } : { kind: "unset" };
}
