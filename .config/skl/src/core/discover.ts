// Build a DiscoveredSkill from raw inputs the shell gathered. Pure: takes the
// SKILL.md path, its contents, and its sibling files; never touches the FS.

import { parseFrontmatter } from "./frontmatter.ts";
import { posixBasename, posixDirname, posixJoin } from "./path.ts";
import type { DiscoveredSkill, Source } from "./types.ts";

export interface BuildSkillInput {
  readonly source: Source;
  /** SKILL.md path relative to the source root, e.g. "nested/deep/beta/SKILL.md". */
  readonly relPath: string;
  /** Full SKILL.md contents. */
  readonly raw: string;
  /** File paths relative to the skill dir (includes SKILL.md). */
  readonly siblingFiles: readonly string[];
}

export const buildSkill = (input: BuildSkillInput): DiscoveredSkill => {
  const { source, relPath, raw, siblingFiles } = input;

  const relDir = posixDirname(relPath); // "alpha", "nested/deep/beta", or "."
  const basename = posixBasename(relDir);
  const dir = relDir === "." ? source.path : posixJoin(source.path, relDir);

  const parsed = parseFrontmatter(raw);
  // Malformed / missing frontmatter never crashes: fall back to the dir basename
  // for name and an empty description.
  const name =
    parsed.ok && parsed.value.name !== null && parsed.value.name.length > 0
      ? parsed.value.name
      : basename;
  const description = parsed.ok ? parsed.value.description : "";

  const files = [...siblingFiles].sort();

  return { source, name, description, dir, files };
};
