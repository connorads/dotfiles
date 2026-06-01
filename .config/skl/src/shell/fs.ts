// Filesystem adapter: config loading + skill discovery. Wraps Bun.file/Bun.Glob
// and hands plain values / DiscoveredSkill[] to the core.

import { Glob } from "bun";
import { ok, err, type Result } from "../core/result.ts";
import { buildSkill } from "../core/discover.ts";
import { posixDirname, posixJoin } from "../core/path.ts";
import type { DiscoveredSkill, Source } from "../core/types.ts";

export type ConfigFileError =
  | { readonly kind: "missing"; readonly path: string }
  | { readonly kind: "parse"; readonly path: string; readonly message: string };

export const loadConfigFile = async (
  path: string,
): Promise<Result<unknown, ConfigFileError>> => {
  const file = Bun.file(path);
  if (!(await file.exists())) return err({ kind: "missing", path });
  try {
    return ok(JSON.parse(await file.text()) as unknown);
  } catch (e) {
    return err({ kind: "parse", path, message: e instanceof Error ? e.message : String(e) });
  }
};

// Glob files under a root, relative to it, SORTED (Bun.Glob is unordered). A
// missing/unreadable root yields no files (a friendly empty result, not a throw).
const globSorted = async (root: string, pattern: string): Promise<string[]> => {
  const glob = new Glob(pattern);
  const rels: string[] = [];
  try {
    for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) rels.push(rel);
  } catch {
    return [];
  }
  rels.sort();
  return rels;
};

/** SKILL.md paths relative to the source root, sorted. */
export const globSkills = (root: string): Promise<string[]> =>
  globSorted(root, "**/SKILL.md");

export const readSkillMd = (absPath: string): Promise<string> =>
  Bun.file(absPath).text();

/** File paths relative to a skill dir (includes SKILL.md), sorted. */
export const siblingFiles = (skillDir: string): Promise<string[]> =>
  globSorted(skillDir, "**/*");

const discoverSource = async (source: Source): Promise<DiscoveredSkill[]> => {
  const rels = await globSkills(source.path);
  const skills: DiscoveredSkill[] = [];
  for (const relPath of rels) {
    const relDir = posixDirname(relPath);
    const dir = relDir === "." ? source.path : posixJoin(source.path, relDir);
    const raw = await readSkillMd(posixJoin(source.path, relPath));
    const sibs = await siblingFiles(dir);
    skills.push(buildSkill({ source, relPath, raw, siblingFiles: sibs }));
  }
  return skills;
};

/** Discover every skill across sources, preserving config (precedence) order. */
export const discoverAll = async (
  sources: readonly Source[],
): Promise<DiscoveredSkill[]> => {
  const all: DiscoveredSkill[] = [];
  for (const source of sources) all.push(...(await discoverSource(source)));
  return all;
};
