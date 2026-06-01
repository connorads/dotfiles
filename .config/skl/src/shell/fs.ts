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

const scanFiles = async (root: string): Promise<string[]> => {
  const glob = new Glob("**/*");
  const out: string[] = [];
  try {
    for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) out.push(rel);
  } catch {
    // Missing/unreadable root → no files (a friendly empty result, not a throw).
    return [];
  }
  return out;
};

/** SKILL.md paths relative to the source root, SORTED (Bun.Glob is unordered). */
export const globSkills = async (root: string): Promise<string[]> => {
  const glob = new Glob("**/SKILL.md");
  const rels: string[] = [];
  try {
    for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) rels.push(rel);
  } catch {
    return [];
  }
  rels.sort();
  return rels;
};

export const readSkillMd = (absPath: string): Promise<string> =>
  Bun.file(absPath).text();

/** File paths relative to a skill dir (includes SKILL.md), sorted. */
export const siblingFiles = async (skillDir: string): Promise<string[]> => {
  const files = await scanFiles(skillDir);
  files.sort();
  return files;
};

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
