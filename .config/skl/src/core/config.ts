// Parse + validate raw config JSON at the boundary into a typed Config. Tilde /
// $HOME expanded here (home injected) so the rest of the core sees absolute paths.

import { ok, err, type Result } from "./result.ts";
import { expandTilde, posixBasename } from "./path.ts";
import type { Config, ConfigError, Source } from "./types.ts";

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

export const parseConfig = (
  raw: unknown,
  home: string,
): Result<Config, ConfigError> => {
  if (!isObject(raw)) return err({ kind: "not-object" });

  const paths = raw["paths"];
  if (!Array.isArray(paths)) return err({ kind: "paths-not-array" });
  if (paths.length === 0) return err({ kind: "empty" });

  const sources: Source[] = [];
  for (let index = 0; index < paths.length; index++) {
    const entry: unknown = paths[index];
    if (!isObject(entry)) return err({ kind: "path-not-object", index });

    const path = entry["path"];
    if (typeof path !== "string" || path.length === 0) {
      return err({ kind: "path-missing", index });
    }

    const rawName = entry["name"];
    if (rawName !== undefined && typeof rawName !== "string") {
      return err({ kind: "name-not-string", index });
    }

    const expanded = expandTilde(path, home);
    const name =
      typeof rawName === "string" && rawName.length > 0
        ? rawName
        : posixBasename(expanded);
    sources.push({ path: expanded, name });
  }

  return ok({ sources });
};

/** Build a Config from `--path` overrides (labels default to basename). */
export const configFromPaths = (paths: readonly string[], home: string): Config => {
  const sources = paths.map((p): Source => {
    const expanded = expandTilde(p, home);
    return { path: expanded, name: posixBasename(expanded) };
  });
  return { sources };
};
