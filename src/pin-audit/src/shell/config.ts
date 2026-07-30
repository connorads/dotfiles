// Reading the mise config, the reason this script exists in TypeScript.
//
// The zsh original scraped TOML with `grep -Eo '"pipx:rembg" = \{ version =
// "[^"]+"'`. That is structure-blind: reformat the entry, move it, or switch it
// between the bare-string and table forms and the match yields empty - which
// the audit then reads as "the pin is gone", a silent false OK on the exact
// check meant to catch a stale pin. Bun.TOML.parse is built in and zero-dep, so
// the config is parsed once and normalised into typed values here; a parse
// failure is reported rather than mistaken for an absent pin.

import type { MiseConfig, ToolEntry } from "../core/types.ts";

export type ConfigRead =
  | { readonly kind: "config"; readonly config: MiseConfig }
  | { readonly kind: "unparseable"; readonly path: string; readonly why: string };

const isTable = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** mise accepts a bare version string or a table; both normalise to ToolEntry. */
const toolEntry = (value: unknown): ToolEntry | null => {
  if (typeof value === "string") return { version: value, prerelease: false };
  if (!isTable(value)) return null;
  const version = value["version"];
  return {
    version: typeof version === "string" ? version : null,
    prerelease: value["prerelease"] === true,
  };
};

const firstLine = (message: string): string => message.split("\n")[0] ?? message;

export const parseMiseConfig = (text: string, path: string): ConfigRead => {
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(text);
  } catch (error) {
    const why = error instanceof Error ? firstLine(error.message) : String(error);
    return { kind: "unparseable", path, why };
  }
  const toolsTable = isTable(parsed) ? parsed["tools"] : undefined;
  const tools: Record<string, ToolEntry> = {};
  if (isTable(toolsTable)) {
    for (const [name, value] of Object.entries(toolsTable)) {
      const entry = toolEntry(value);
      if (entry !== null) tools[name] = entry;
    }
  }
  return { kind: "config", config: { path, tools } };
};

export const readMiseConfig = async (path: string): Promise<ConfigRead> => {
  const file = Bun.file(path);
  // A config that isn't there genuinely has no pins - the same reading as the
  // grep this replaces, and each check then self-reports as droppable.
  if (!(await file.exists())) return { kind: "config", config: { path, tools: {} } };
  return parseMiseConfig(await file.text(), path);
};
