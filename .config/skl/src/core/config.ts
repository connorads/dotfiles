// Parse + validate raw config JSON at the boundary into a typed Config. Tilde /
// $HOME expanded here (home injected) so the rest of the core sees absolute paths.

import { ok, err, type Result } from "./result.ts";
import { expandTilde, posixBasename } from "./path.ts";
import { BUILTIN_PAYLOAD_EXCLUDES } from "./payload.ts";
import type { Config, ConfigError, Source } from "./types.ts";

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

export const parseConfig = (
  raw: unknown,
  home: string,
): Result<Config, ConfigError> => {
  if (!isObject(raw)) return err({ kind: "not-object" });

  const topExclude = raw["exclude"];
  const topExcludes: string[] = [];
  if (topExclude !== undefined) {
    if (!Array.isArray(topExclude)) return err({ kind: "exclude-not-array" });
    for (let index = 0; index < topExclude.length; index++) {
      const pattern: unknown = topExclude[index];
      if (typeof pattern !== "string") return err({ kind: "exclude-not-string", index });
      topExcludes.push(pattern);
    }
  }

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

    const sourceExclude = entry["exclude"];
    const sourceExcludes: string[] = [];
    if (sourceExclude !== undefined) {
      if (!Array.isArray(sourceExclude)) {
        return err({ kind: "path-exclude-not-array", pathIndex: index });
      }
      for (let excludeIndex = 0; excludeIndex < sourceExclude.length; excludeIndex++) {
        const pattern: unknown = sourceExclude[excludeIndex];
        if (typeof pattern !== "string") {
          return err({
            kind: "path-exclude-not-string",
            pathIndex: index,
            index: excludeIndex,
          });
        }
        sourceExcludes.push(pattern);
      }
    }

    const expanded = expandTilde(path, home);
    const name =
      typeof rawName === "string" && rawName.length > 0
        ? rawName
        : posixBasename(expanded);
    sources.push({
      path: expanded,
      name,
      exclude: [...BUILTIN_PAYLOAD_EXCLUDES, ...topExcludes, ...sourceExcludes],
    });
  }

  return ok({ sources });
};

/** Build a Config from `--path` overrides (labels default to basename). */
export const configFromPaths = (paths: readonly string[], home: string): Config => {
  const sources = paths.map((p): Source => {
    const expanded = expandTilde(p, home);
    return {
      path: expanded,
      name: posixBasename(expanded),
      exclude: BUILTIN_PAYLOAD_EXCLUDES,
    };
  });
  return { sources };
};
