import { z } from "zod";

export const ConnectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(60),
  url: z.url(),
});
export type Connection = z.infer<typeof ConnectionSchema>;

export type ApprovalMode = "model" | "browser";

export function approvalMode(url: string): ApprovalMode {
  return new URL(url).searchParams.get("elicitation_mode") === "browser" ? "browser" : "model";
}

/** A thread follows inheritance (`default`), names one connection, or turns Executor off. */
export type ThreadChoice = { kind: "default" } | { kind: "connection"; id: string } | { kind: "off" };

/** A project or global default names one connection or explicitly turns Executor off. */
export type ScopedChoice = { kind: "connection"; id: string } | { kind: "off" };

export type ResolutionSource = "thread" | "owner" | "project" | "default";

export type ResolvedChoice =
  | { kind: "connection"; connection: Connection; source: ResolutionSource }
  | { kind: "off"; source: ResolutionSource }
  | { kind: "unset"; source: ResolutionSource };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Accepts the URL from Executor's Connect page. Keeps `connection` and browser approval delivery, so
 * the URL matches the resource Executor binds the grant to. Native mode is refused because the plugin has no form elicitation support.
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
  if (mode && mode !== "model" && mode !== "browser") {
    return { ok: false, message: "Use model or browser approval mode. Native approval mode is unsupported." };
  }
  const connection = url.searchParams.get("connection");
  url.search = "";
  if (connection) url.searchParams.set("connection", connection);
  if (mode === "browser") url.searchParams.set("elicitation_mode", mode);
  url.hash = "";
  return { ok: true, url };
}

export function slugFor(name: string, taken: ReadonlySet<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "connection";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** The thread that started this one: its parent, else the origin of its BB workflow run. */
export function ownerOf(thread: {
  parentThreadId?: string | null;
  originPluginId?: string | null;
  lifecycleOwnerThreadId?: string | null;
}): string | null {
  if (thread.parentThreadId) return thread.parentThreadId;
  return thread.originPluginId === "workflows" ? (thread.lifecycleOwnerThreadId ?? null) : null;
}

/** The connection a thread uses: its own choice while that exists, else the default. */
export function resolveChoice(
  choice: ThreadChoice,
  defaultId: string | null,
  connections: readonly Connection[],
): { kind: "connection"; connection: Connection } | { kind: "off" } | { kind: "unset" } {
  const resolved = resolveHierarchy({
    thread: choice,
    owner: null,
    project: null,
    globalDefault: defaultId ? { kind: "connection", id: defaultId } : null,
    connections,
  });
  if (resolved.kind === "connection") return { kind: "connection", connection: resolved.connection };
  return { kind: resolved.kind };
}

/**
 * Resolves a thread's effective Executor connection across four levels:
 * thread override → parent/workflow owner → project default → global default.
 */
export function resolveHierarchy({
  thread,
  owner,
  project,
  globalDefault,
  connections,
}: {
  thread: ThreadChoice;
  owner: ResolvedChoice | null;
  project: ScopedChoice | null;
  globalDefault: ScopedChoice | null;
  connections: readonly Connection[];
}): ResolvedChoice {
  const byId = (id: string) => connections.find((c) => c.id === id);

  if (thread.kind === "off") return { kind: "off", source: "thread" };
  if (thread.kind === "connection") {
    const found = byId(thread.id);
    if (found) return { kind: "connection", connection: found, source: "thread" };
  }

  if (owner) {
    if (owner.kind === "connection") return { kind: "connection", connection: owner.connection, source: "owner" };
    if (owner.kind === "off") return { kind: "off", source: "owner" };
    return { kind: "unset", source: "owner" };
  }

  if (project) {
    if (project.kind === "off") return { kind: "off", source: "project" };
    const found = byId(project.id);
    if (found) return { kind: "connection", connection: found, source: "project" };
  }

  if (globalDefault) {
    if (globalDefault.kind === "off") return { kind: "off", source: "default" };
    const found = byId(globalDefault.id);
    if (found) return { kind: "connection", connection: found, source: "default" };
  }

  return { kind: "unset", source: "default" };
}
