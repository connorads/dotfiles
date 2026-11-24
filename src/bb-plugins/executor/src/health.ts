import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import type { ConnectionAppView, ConnectionHealthView } from "../contracts.ts";

export function unknownHealth(): ConnectionHealthView {
  return { state: "unknown", checkedAt: null, message: null, apps: [], toolCount: null };
}

export function hostFor(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return rawUrl;
  }
}

/** Where to send the person when an app inside Executor needs attention. */
export function webUrlFor(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === "mcp.executor.sh") return "https://app.executor.sh";
    return url.origin;
  } catch {
    return "https://app.executor.sh";
  }
}

/**
 * Turns Executor's `accounts` string (e.g. "service: acc_788a84e2-... (Connor (Read only))")
 * into a concise human label ("Connor (Read only)").
 */
export function formatAccountLabel(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const labels: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "(") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0 && start !== -1) {
        const label = trimmed.slice(start, i).trim();
        if (label) labels.push(label);
        start = -1;
      }
    }
  }
  if (labels.length > 0) return labels.join(", ");
  const cleaned = trimmed.replace(/\b(?:service|oauth|api[_-]?key|token):\s*/gi, "").replace(/\bacc_[a-z0-9_-]+/gi, "").trim();
  return cleaned || trimmed;
}

/** Trims verbose Executor diagnostic footers ("Recovery: ... Reference: ...") down to the core reason. */
export function conciseReason(raw: string | undefined): string {
  if (!raw) return "Needs attention in Executor";
  let text = raw.trim();
  text = text.replace(/^AppEvaluationFailed\s*\(([^)]+)\):\s*/i, "$1: ");
  text = text.replace(/\s+Recovery:[\s\S]*$/i, "");
  text = text.replace(/\s+Retryable\b[\s\S]*$/i, "");
  text = text.replace(/\s+Phase:[\s\S]*$/i, "");
  text = text.replace(/\s+Reference:[\s\S]*$/i, "");
  text = text.trim();
  if (text.length > 120) text = `${text.slice(0, 117).trimEnd()}…`;
  return text || "Needs attention in Executor";
}

export type ParsedInventory = {
  apps: ConnectionAppView[];
  toolCount: number | null;
  unavailableCount: number;
};

/**
 * Inspects an Executor `skills({})` tool result to discover every visible app
 * that ships skills, plus any `unavailableApps`.
 */
export function parseSkillsInventory(result: CallToolResult): ParsedInventory | null {
  const payload = extractPayload(result);
  if (!payload) return null;
  if (!("skills" in payload || "unavailableApps" in payload)) return null;

  const apps: ConnectionAppView[] = [];
  const byKey = new Map<string, ConnectionAppView>();

  if (Array.isArray(payload["skills"])) {
    for (const entry of payload["skills"]) {
      if (!isRecord(entry)) continue;
      const appObj = isRecord(entry["app"]) ? entry["app"] : null;
      const name = stringOf(appObj?.["name"]) ?? stringOf(appObj?.["slug"]) ?? stringOf(entry["app"]);
      const slug = stringOf(appObj?.["slug"]);
      if (!name || isOpaqueId(name)) continue;
      const key = (slug ?? name).toLowerCase();
      if (byKey.has(key) || byKey.has(name.toLowerCase())) continue;
      const item: ConnectionAppView = { app: name, account: null, ok: true, reason: null };
      apps.push(item);
      byKey.set(key, item);
      byKey.set(name.toLowerCase(), item);
    }
  }

  let unavailableCount = 0;
  if (Array.isArray(payload["unavailableApps"])) {
    for (const entry of payload["unavailableApps"]) {
      const parsed = parseUnavailable(entry);
      if (!parsed) continue;
      unavailableCount++;
      const existing = byKey.get(parsed.app.toLowerCase()) ?? (parsed.slug ? byKey.get(parsed.slug.toLowerCase()) : undefined);
      if (existing) {
        existing.ok = false;
        existing.reason = parsed.reason;
      } else {
        const item: ConnectionAppView = { app: parsed.app, account: null, ok: false, reason: parsed.reason };
        apps.push(item);
        byKey.set(parsed.app.toLowerCase(), item);
      }
    }
  }

  return { apps, toolCount: null, unavailableCount };
}

/**
 * Inspects an Executor `search` tool result for namespaces, linked accounts,
 * unavailable apps, and total tool count. Tolerates partial or non-standard shapes.
 */
export function parseSearchInventory(result: CallToolResult): ParsedInventory | null {
  const payload = extractPayload(result);
  if (!payload) return null;

  const hasKnownKey = "namespaces" in payload || "unavailableApps" in payload || "remaining" in payload || "items" in payload;
  if (!hasKnownKey) return null;

  const apps: ConnectionAppView[] = [];
  const byKey = new Map<string, ConnectionAppView>();

  if (Array.isArray(payload["namespaces"])) {
    for (const entry of payload["namespaces"]) {
      if (!isRecord(entry)) continue;
      const appName = stringOf(entry["app"]) ?? stringOf(entry["name"]) ?? stringOf(entry["label"]) ?? namespaceSlug(stringOf(entry["path"]));
      if (!appName) continue;
      const account = formatAccountLabel(stringOf(entry["accounts"]) ?? stringOf(entry["account"]));
      const existing = byKey.get(appName.toLowerCase());
      if (existing) {
        if (!existing.account && account) existing.account = account;
        continue;
      }
      const item: ConnectionAppView = { app: appName, account, ok: true, reason: null };
      apps.push(item);
      byKey.set(appName.toLowerCase(), item);
      const slug = namespaceSlug(stringOf(entry["path"]));
      if (slug) byKey.set(slug.toLowerCase(), item);
    }
  }

  let unavailableCount = 0;
  if (Array.isArray(payload["unavailableApps"])) {
    for (const entry of payload["unavailableApps"]) {
      const parsed = parseUnavailable(entry);
      if (!parsed) continue;
      unavailableCount++;
      const existing = byKey.get(parsed.app.toLowerCase()) ?? (parsed.slug ? byKey.get(parsed.slug.toLowerCase()) : undefined);
      if (existing) {
        existing.ok = false;
        existing.reason = parsed.reason;
      } else {
        const item: ConnectionAppView = { app: parsed.app, account: null, ok: false, reason: parsed.reason };
        apps.push(item);
        byKey.set(parsed.app.toLowerCase(), item);
      }
    }
  }

  let toolCount: number | null = null;
  const items = Array.isArray(payload["items"]) ? payload["items"].length : null;
  const remaining = typeof payload["remaining"] === "number" && Number.isFinite(payload["remaining"]) ? payload["remaining"] : null;
  if (items !== null && remaining !== null) toolCount = items + remaining;
  else if (remaining !== null) toolCount = remaining;
  else if (items !== null && payload["next"] === null) toolCount = items;

  return { apps, toolCount, unavailableCount };
}

/** Merges `skills({})` and `search({ limit: 1 })` inventories, placing broken apps first then alphabetical. */
export function mergeInventories(...parts: Array<ParsedInventory | null | undefined>): ParsedInventory | null {
  const valid = parts.filter((p): p is ParsedInventory => p !== null && p !== undefined);
  if (valid.length === 0) return null;

  const merged = new Map<string, ConnectionAppView>();
  let toolCount: number | null = null;

  for (const part of valid) {
    if (part.toolCount !== null) toolCount = part.toolCount;
    for (const app of part.apps) {
      const key = app.app.toLowerCase();
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...app });
      } else {
        if (!existing.account && app.account) existing.account = app.account;
        if (!app.ok) {
          existing.ok = false;
          existing.reason = app.reason ?? existing.reason;
        }
      }
    }
  }

  const apps = [...merged.values()].sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? 1 : -1;
    return a.app.localeCompare(b.app);
  });
  const unavailableCount = apps.filter((a) => !a.ok).length;
  return { apps, toolCount, unavailableCount };
}

/** Picks minimal read-only arguments for Executor's `search` tool, or null if unsupported. */
export function searchProbeArgs(tools: readonly Tool[]): Record<string, unknown> | null {
  const search = tools.find((t) => t.name === "search");
  if (!search) return null;
  const schema = isRecord(search.inputSchema) ? search.inputSchema : null;
  const required = Array.isArray(schema?.["required"]) ? schema["required"].filter((v): v is string => typeof v === "string") : [];
  const props = isRecord(schema?.["properties"]) ? schema["properties"] : {};
  const args: Record<string, unknown> = {};
  if ("limit" in props) args["limit"] = 1;
  for (const field of required) {
    if (field in args) continue;
    if (field === "query") args["query"] = "";
    else return null;
  }
  return args;
}

/** Returns `{}` when Executor's `skills` tool accepts an empty listing input. */
export function skillsProbeArgs(tools: readonly Tool[]): Record<string, unknown> | null {
  const skills = tools.find((t) => t.name === "skills");
  if (!skills) return null;
  const schema = isRecord(skills.inputSchema) ? skills.inputSchema : null;
  const required = Array.isArray(schema?.["required"]) ? schema["required"].filter((v): v is string => typeof v === "string") : [];
  return required.length === 0 ? {} : null;
}

function extractPayload(result: CallToolResult): Record<string, unknown> | null {
  if (result.isError) return null;
  if (isRecord(result.structuredContent)) return result.structuredContent;
  for (const part of result.content) {
    if (part.type !== "text") continue;
    try {
      const parsed: unknown = JSON.parse(part.text);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Ignore non-JSON text parts.
    }
  }
  return null;
}

function parseUnavailable(entry: unknown): { app: string; slug?: string; reason: string } | null {
  if (typeof entry === "string" && entry.trim()) {
    return { app: entry.trim(), reason: "Needs attention in Executor" };
  }
  if (!isRecord(entry)) return null;
  const rawApp = stringOf(entry["app"]);
  const slug = stringOf(entry["slug"]) ?? stringOf(entry["id"]) ?? namespaceSlug(stringOf(entry["path"]));
  // Prefer human display `name`/`label` over opaque IDs like `app_f88e8ec7-...`.
  const app = stringOf(entry["name"])
    ?? stringOf(entry["label"])
    ?? (rawApp && !isOpaqueId(rawApp) ? rawApp : undefined)
    ?? slug;
  if (!app) return null;
  const reason = conciseReason(stringOf(entry["reason"]) ?? stringOf(entry["message"]) ?? stringOf(entry["error"]) ?? stringOf(entry["status"]));
  return { app, ...(slug ? { slug } : {}), reason };
}

function isOpaqueId(value: string): boolean {
  return /^app_[0-9a-f-]{8,}$/i.test(value);
}

function namespaceSlug(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const bracket = /^tools\["([^"]+)"\]/.exec(path);
  if (bracket?.[1]) return bracket[1];
  const dot = /^tools\.([^.\s]+)/.exec(path);
  return dot?.[1];
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
