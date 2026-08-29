// Text measurement for excerpts: the fingerprint, and the fence width a
// Markdown code block needs to survive backticks inside the excerpt.

import { createHash } from "node:crypto";

/** How much of the excerpt's head and tail the fingerprint keeps. */
export const FINGERPRINT_EDGE = 80;

/**
 * An excerpt's identity as captured. Nothing reads this yet; it exists so a
 * later version can re-anchor an excerpt against its source without a store
 * migration. Verbatim records with no provenance cannot be re-anchored.
 */
export interface Fingerprint {
  readonly sha256: string;
  readonly bytes: number;
  readonly lines: number;
  /** First `FINGERPRINT_EDGE` characters, verbatim. */
  readonly head: string;
  /** Last `FINGERPRINT_EDGE` characters, verbatim. */
  readonly tail: string;
}

export const fingerprint = (text: string): Fingerprint => ({
  sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  bytes: Buffer.byteLength(text, "utf8"),
  lines: countLines(text),
  head: text.slice(0, FINGERPRINT_EDGE),
  tail: text.length <= FINGERPRINT_EDGE ? text : text.slice(-FINGERPRINT_EDGE),
});

/**
 * Lines in a passage. A trailing newline terminates the last line rather than
 * starting an empty one, so "a\nb\n" and "a\nb" both count 2.
 */
export const countLines = (text: string): number => {
  if (text.length === 0) return 0;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n").length;
};

/** The longest run of consecutive backticks anywhere in the text. */
export const longestBacktickRun = (text: string): number => {
  let longest = 0;
  let run = 0;
  for (const ch of text) {
    if (ch === "`") {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return longest;
};

/** Minimum fence a CommonMark code block may use. */
export const MIN_FENCE = 3;

/**
 * The fence for a block holding `text`: always longer than the longest
 * backtick run inside it, and never shorter than three.
 */
export const fenceFor = (text: string): string =>
  "`".repeat(Math.max(MIN_FENCE, longestBacktickRun(text) + 1));

/** The excerpt's first non-blank line, trimmed - what `list` shows as a label. */
export const firstLine = (text: string): string => {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
};

/** Shorten to `width` characters, marking the cut with a single ellipsis. */
export const ellipsise = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
