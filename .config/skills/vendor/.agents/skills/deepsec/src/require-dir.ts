import fs from "node:fs";
import path from "node:path";

/**
 * Verify a path exists and is a directory. Throws with `source` attribution
 * so the user knows which input was bad ("--root", "deepsec.config.ts",
 * "data/<id>/project.json:rootPath", …).
 *
 * Returns the canonical absolute path (symlinks resolved) on success.
 * Canonicalizing here avoids macOS `/tmp` vs `/private/tmp` mismatches
 * later when computing `path.relative()` against `process.cwd()`.
 */
export function requireExistingDir(p: string, source: string): string {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) {
    throw new Error(`Path does not exist: ${abs}\n  (came from ${source})`);
  }
  if (!fs.statSync(abs).isDirectory()) {
    throw new Error(`Not a directory: ${abs}\n  (came from ${source})`);
  }
  return fs.realpathSync(abs);
}
