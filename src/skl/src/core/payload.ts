// Payload filtering for skill sibling files. Patterns use Bun glob syntax and
// are evaluated against paths relative to the discovered skill directory.

import { Glob } from "bun";

export const BUILTIN_PAYLOAD_EXCLUDES: readonly string[] = [
  "**/.DS_Store",
  "**/.git/**",
  "**/.claude/**",
  "**/.rumdl_cache/**",
  "**/__pycache__/**",
  "**/*.py[cod]",
  "**/*.backup",
  "**/node_modules/**",
  "evals/**",
];

const isRootSkillMd = (relPath: string): boolean => relPath === "SKILL.md";

export const filterPayloadFiles = (
  relPaths: readonly string[],
  excludes: readonly string[],
): string[] => {
  const globs = excludes.map((pattern) => new Glob(pattern));
  return relPaths.filter((relPath) => {
    if (isRootSkillMd(relPath)) return true;
    return !globs.some((glob) => glob.match(relPath));
  });
};
