// Usage-history file adapter: resolve the JSONL path, append lines, read the
// file back. Machine-local state (XDG state dir), never dotfiles-tracked.
// `SKL_HISTORY_FILE` overrides the path — the test seam.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ok, err, type Result } from "../core/result.ts";
import { env } from "./env.ts";

export const historyFilePath = (): string =>
  env.historyFileOverride() ?? `${env.xdgStateHome()}/skl/history.jsonl`;

/** Append one pre-rendered JSONL line, creating the parent dir if needed. */
export const appendHistory = async (line: string): Promise<Result<void, string>> => {
  const path = historyFilePath();
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, line);
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
};

/** Whole history file; `""` when it does not exist yet. */
export const readHistoryFile = async (): Promise<string> => {
  const file = Bun.file(historyFilePath());
  if (!(await file.exists())) return "";
  return file.text();
};
