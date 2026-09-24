// Ambient environment, read in one place so tests override it with env vars
// rather than mocks.

import { tmpdir } from "node:os";
import type { CallerEnv } from "../core/caller.ts";

export interface Env {
  readonly home: string;
  readonly tmpdir: string;
  readonly caller: CallerEnv;
}

const nonEmpty = (v: string | undefined): string | null => (v === undefined || v === "" ? null : v);

export const readEnv = (source: NodeJS.ProcessEnv = process.env): Env => ({
  home: source["HOME"] ?? "",
  tmpdir: source["TMPDIR"] ?? tmpdir(),
  caller: {
    codexThreadId: nonEmpty(source["CODEX_THREAD_ID"]),
    claudeCode: nonEmpty(source["CLAUDECODE"]),
  },
});
