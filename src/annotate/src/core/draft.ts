// What a draft has to satisfy before it is worth delivering.

import { DRAFT_PREAMBLE } from "./render.ts";
import { err, ok, type Result } from "./result.ts";

/**
 * Ceiling on a whole draft. `agent prompt` passes the body as one argv word
 * and ARG_MAX counts the environment too, so this is a real limit as well as a
 * mistake catcher - 900 KiB was measured to pass, and this leaves headroom.
 */
export const MAX_DRAFT_BYTES = 512 * 1024;

export type DraftProblem =
  | { readonly kind: "empty" }
  | { readonly kind: "tooLarge"; readonly bytes: number; readonly limit: number };

export const describeProblem = (problem: DraftProblem): string =>
  problem.kind === "empty"
    ? "draft is empty - nothing to send"
    : `draft is ${Math.round(problem.bytes / 1024)} KiB, over the ${Math.round(
        problem.limit / 1024,
      )} KiB limit - use 'annotate render > review.md' instead`;

/**
 * The text a draft actually delivers: the editing preamble is instructions to
 * the reader, not to the agent, so it is stripped on the way out.
 */
export const deliverable = (markdown: string): string =>
  markdown.startsWith(DRAFT_PREAMBLE)
    ? markdown.slice(DRAFT_PREAMBLE.length).replace(/^\n+/, "")
    : markdown;

/**
 * A draft ready to send, or why it is not. Whitespace-only counts as empty, so
 * deleting every section in the editor is a clean no-op rather than delivering
 * a blank prompt.
 */
export const readyToSend = (markdown: string): Result<string, DraftProblem> => {
  const body = deliverable(markdown).trim();
  if (body.length === 0) return err({ kind: "empty" });
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > MAX_DRAFT_BYTES) return err({ kind: "tooLarge", bytes, limit: MAX_DRAFT_BYTES });
  return ok(body);
};
