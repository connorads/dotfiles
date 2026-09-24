// Findings -> a GitHub review payload. GitHub only accepts an inline comment
// on a line inside the PR diff, so each finding anchors to its line when that
// line is in a hunk on the new side, and otherwise goes into the review body.
// The payload has no `event`, which is what makes GitHub create the review as
// PENDING: visible only to its author until they submit it.

import { location } from "./render.ts";
import type { Finding, Review } from "./types.ts";

/** file -> new-side line -> hunk index, for lines GitHub can comment on. */
export type HunkLines = ReadonlyMap<string, ReadonlyMap<number, number>>;

export const hunkLines = (diff: string): HunkLines => {
  const files = new Map<string, Map<number, number>>();
  let current: Map<number, number> | null = null;
  let line = 0;
  let hunk = -1;
  for (const text of diff.split("\n")) {
    if (text.startsWith("diff --git ")) {
      current = null;
    } else if (text.startsWith("+++ ")) {
      const path = text.slice(4);
      current = path === "/dev/null" ? null : new Map();
      if (current !== null) files.set(path.replace(/^b\//, ""), current);
    } else if (text.startsWith("@@ ")) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      line = m ? Number(m[1]) : 0;
      hunk++;
    } else if (current !== null && line > 0) {
      if (text.startsWith("+") || text.startsWith(" ")) current.set(line++, hunk);
    }
  }
  return files;
};

export interface InlineComment {
  readonly path: string;
  readonly line: number;
  readonly side: "RIGHT";
  readonly start_line?: number;
  readonly start_side?: "RIGHT";
  readonly body: string;
}

export interface ReviewPayload {
  readonly commit_id: string;
  readonly body: string;
  readonly comments: readonly InlineComment[];
}

const findingBody = (f: Finding): string =>
  [
    `**[${f.severity}] ${f.title}** (confidence ${f.confidence} · ${f.reviewers.join(" + ")})`,
    "",
    f.body,
    ...(f.recommendation.trim() === "" ? [] : ["", `**Recommendation.** ${f.recommendation}`]),
  ].join("\n");

const anchor = (f: Finding, lines: HunkLines): InlineComment | null => {
  if (f.file === null || f.line_start === null) return null;
  const inFile = lines.get(f.file);
  const end = f.line_end ?? f.line_start;
  const hunk = inFile?.get(end);
  if (inFile === undefined || hunk === undefined) return null;
  const base = { path: f.file, line: end, side: "RIGHT" as const, body: findingBody(f) };
  return f.line_start < end && inFile.get(f.line_start) === hunk
    ? { ...base, start_line: f.line_start, start_side: "RIGHT" }
    : base;
};

export const reviewPayload = (review: Review, headSha: string, diff: string): ReviewPayload => {
  const lines = hunkLines(diff);
  const comments: InlineComment[] = [];
  const outside: string[] = [];
  for (const f of review.findings) {
    const c = anchor(f, lines);
    if (c !== null) comments.push(c);
    else outside.push(`#### ${location(f) ?? "(no location)"}\n\n${findingBody(f)}`);
  }
  const reviewers = review.reviewers.map((s) => `${s.kind} (${s.model})`).join(", ");
  const body = [
    `**critique: ${review.verdict ?? "failed"}** (${reviewers})`,
    "",
    review.summary,
    ...(outside.length === 0 ? [] : ["", "### Findings outside the diff", "", outside.join("\n\n")]),
  ].join("\n");
  return { commit_id: headSha, body, comments };
};
