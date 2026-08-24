// Payload filtering for skill sibling files. Patterns use Bun glob syntax and
// are evaluated against paths relative to the discovered skill directory.

import { Glob } from "bun";

export const BUILTIN_PAYLOAD_EXCLUDES: readonly string[] = [
  "**/.DS_Store",
  "**/.git/**",
  "**/.claude/**",
  "**/__pycache__/**",
  "**/*.py[cod]",
  "**/*.backup",
  "**/node_modules/**",
  "evals/**",
];

const isRootSkillMd = (relPath: string): boolean => relPath === "SKILL.md";

// Cache Directory Tagging Spec: a directory holding CACHEDIR.TAG is declared a
// cache by the tool that wrote it, so its whole subtree is generated, never
// payload. A self-declaration rather than a guess at a directory name, so it
// needs no edit when the next tool arrives.
const CACHE_TAG = "CACHEDIR.TAG";
const NESTED_CACHE_TAG = `/${CACHE_TAG}`;

const isCacheTag = (relPath: string): boolean =>
  relPath === CACHE_TAG || relPath.endsWith(NESTED_CACHE_TAG);

// Directory prefixes of tagged caches, trailing slash kept so a prefix match
// drops the tag file along with its siblings. Only a *nested* tag marks a
// directory: at the skill root the prefix would be empty and erase the whole
// skill, so a root tag excludes nothing but itself.
const taggedCacheDirs = (relPaths: readonly string[]): string[] =>
  relPaths
    .filter((relPath) => relPath.endsWith(NESTED_CACHE_TAG))
    .map((relPath) => relPath.slice(0, -CACHE_TAG.length));

export const filterPayloadFiles = (
  relPaths: readonly string[],
  excludes: readonly string[],
): string[] => {
  const globs = excludes.map((pattern) => new Glob(pattern));
  const cacheDirs = taggedCacheDirs(relPaths);
  return relPaths.filter((relPath) => {
    if (isRootSkillMd(relPath)) return true;
    if (isCacheTag(relPath)) return false;
    if (cacheDirs.some((dir) => relPath.startsWith(dir))) return false;
    return !globs.some((glob) => glob.match(relPath));
  });
};
