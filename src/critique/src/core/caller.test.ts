import { expect, test } from "bun:test";
import { defaultReviewer } from "./caller.ts";

test.each([
  [{ codexThreadId: null, claudeCode: null }, "codex"],
  [{ codexThreadId: null, claudeCode: "1" }, "codex"],
  [{ codexThreadId: "t-1", claudeCode: null }, "claude"],
  // Codex launched from a Claude pane inherits CLAUDECODE; the innermost
  // caller is Codex, so Claude reviews.
  [{ codexThreadId: "t-1", claudeCode: "1" }, "claude"],
  [{ codexThreadId: "", claudeCode: "" }, "codex"],
] as const)("%o -> %s", (env, want) => {
  expect(defaultReviewer(env)).toBe(want);
});
