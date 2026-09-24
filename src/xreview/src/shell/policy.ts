// The secret-path list, read from the srt base policy that every agent surface
// mirrors (the secret-path-parity hk step enforces the mirroring). Required:
// a reviewer that cannot learn which paths are secret does not run.

import { join } from "node:path";
import { err, ok, type Result } from "../core/result.ts";

export const basePolicyPath = (home: string): string => join(home, ".config", "srt", "base.json");

export const loadDenyRead = async (home: string): Promise<Result<string[], string>> => {
  const path = basePolicyPath(home);
  let policy: unknown;
  try {
    policy = await Bun.file(path).json();
  } catch (e) {
    return err(`cannot read the srt policy ${path}: ${(e as Error).message}`);
  }
  const list = (policy as { filesystem?: { denyRead?: unknown } }).filesystem?.denyRead;
  if (!Array.isArray(list) || !list.every((p) => typeof p === "string")) {
    return err(`${path}: filesystem.denyRead is not a string array`);
  }
  return ok(list);
};
