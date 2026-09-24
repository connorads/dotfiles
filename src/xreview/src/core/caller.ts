// Which agent is calling, so the default reviewer is the other one. Both CLIs
// export a marker into the shells they spawn: Codex sets CODEX_THREAD_ID,
// Claude Code sets CLAUDECODE. Codex is checked first because a Codex session
// launched from inside Claude inherits CLAUDECODE too.

import type { ReviewerKind } from "./types.ts";

export interface CallerEnv {
  readonly codexThreadId: string | null;
  readonly claudeCode: string | null;
}

export const defaultReviewer = (env: CallerEnv): ReviewerKind => {
  if (env.codexThreadId) return "claude";
  if (env.claudeCode) return "codex";
  return "codex";
};
