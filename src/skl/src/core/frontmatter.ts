// Parse the leading `---` fenced YAML block of a SKILL.md. Pure: never throws,
// never reads the filesystem. Uses Bun.YAML.parse (zero-dep, Bun 1.3.14+).

import { ok, err, type Result } from "./result.ts";
import type { Frontmatter, FrontmatterError } from "./types.ts";

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---/;

const isMapping = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

export const parseFrontmatter = (
  raw: string,
): Result<Frontmatter, FrontmatterError> => {
  const match = raw.match(FENCE);
  if (match === null) return err({ kind: "no-frontmatter" });
  const block = match[1] ?? "";

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(block);
  } catch (e) {
    return err({ kind: "yaml-error", message: e instanceof Error ? e.message : String(e) });
  }

  // A non-mapping (list, scalar, null) has no readable `name` field.
  if (!isMapping(parsed)) return err({ kind: "name-not-string" });

  const rawName = parsed["name"];
  if (rawName !== undefined && typeof rawName !== "string") {
    return err({ kind: "name-not-string" });
  }
  const name = typeof rawName === "string" ? rawName : null;

  const rawDesc = parsed["description"];
  const description = typeof rawDesc === "string" ? rawDesc : "";

  return ok({ name, description });
};
