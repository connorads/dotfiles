// A rubric is an skl skill; `skl inline` prints its whole bundle (SKILL.md
// plus retained files), so the reviewer needs no skl or filesystem access.

import { err, ok, type Result } from "../core/result.ts";
import { run, tail } from "./proc.ts";

export const inlineRubric = async (ref: string): Promise<Result<string, string>> => {
  const r = await run(["skl", "inline", ref]);
  if (r.code !== 0) return err(`skl inline ${ref}: ${tail(r.stderr) || `exit ${r.code}`}`);
  return r.stdout.trim() === "" ? err(`skl inline ${ref}: empty`) : ok(r.stdout);
};
