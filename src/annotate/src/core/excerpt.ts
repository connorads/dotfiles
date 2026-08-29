// The captured unit and its provenance.
//
// An excerpt carries no comment: at capture there is nothing to say yet, and
// that is the whole point - one key, no popup, stay in the review flow. A
// comment exists only once it is written into the draft, and is never stored
// as a record.

import { fingerprint, type Fingerprint } from "./text.ts";
import { excerptId, isoTimestamp, type IdSeed } from "./ids.ts";
import { err, ok, type Result } from "./result.ts";

/** A surface an excerpt can be taken from. */
export const SOURCE_KINDS = ["selection", "pane", "transcript"] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export const isSourceKind = (value: unknown): value is SourceKind =>
  typeof value === "string" && (SOURCE_KINDS as readonly string[]).includes(value);

/**
 * Where an excerpt came from, recorded at capture. Every field beyond `kind`
 * is optional: a piped stash with no flags still produces a valid excerpt.
 */
export interface Origin {
  readonly kind: SourceKind;
  /** tmux pane id, e.g. `%12`. */
  readonly pane: string | null;
  /** Agent kind as `agent ls` reports it, e.g. `claude`, `codex`. */
  readonly agentKind: string | null;
  /** The pane's `agent name` label, when it has one. */
  readonly agentName: string | null;
  readonly cwd: string | null;
  /** tmux session name. */
  readonly session: string | null;
  /** Transcript message uuid, for the transcript source. */
  readonly entryId: string | null;
}

/**
 * An origin as it comes back out of the store. The extra variant is what lets
 * an excerpt written by a newer binary - one that knows a source this build
 * does not - still render, under a generic heading, instead of being dropped.
 */
export type StoredOrigin = Origin | { readonly kind: "unknown"; readonly raw: string };

export interface Excerpt {
  readonly schemaVersion: 1;
  readonly id: string;
  /** ISO-8601 UTC capture time. */
  readonly ts: string;
  /** The passage, verbatim as captured. Never re-resolved at render time. */
  readonly text: string;
  readonly origin: StoredOrigin;
  readonly fingerprint: Fingerprint;
}

/** Per-excerpt ceiling. A capture past this is a mistake worth catching. */
export const MAX_EXCERPT_BYTES = 256 * 1024;

export type CaptureError =
  | { readonly kind: "empty" }
  | { readonly kind: "tooLarge"; readonly bytes: number; readonly limit: number };

export const emptyOrigin = (kind: SourceKind): Origin => ({
  kind,
  pane: null,
  agentKind: null,
  agentName: null,
  cwd: null,
  session: null,
  entryId: null,
});

/**
 * Build an excerpt from captured text. An empty capture is a benign no-op
 * rather than an error - pressing the key with no selection should say so and
 * exit 0, not fail.
 */
export const captureExcerpt = (
  text: string,
  origin: Origin,
  seed: IdSeed,
): Result<Excerpt, CaptureError> => {
  if (text.trim().length === 0) return err({ kind: "empty" });
  const print = fingerprint(text);
  if (print.bytes > MAX_EXCERPT_BYTES) {
    return err({ kind: "tooLarge", bytes: print.bytes, limit: MAX_EXCERPT_BYTES });
  }
  return ok({
    schemaVersion: 1,
    id: excerptId(seed),
    ts: isoTimestamp(seed.now),
    text,
    origin,
    fingerprint: print,
  });
};

// ---------------------------------------------------------------------------
// Boundary parsers - smart constructors over whatever the store hands back
// ---------------------------------------------------------------------------

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const parseOrigin = (value: unknown): StoredOrigin | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const kind = raw["kind"];
  if (!isSourceKind(kind)) {
    // A source this build does not know. Keep the record readable rather than
    // discarding an excerpt a newer binary captured.
    return { kind: "unknown", raw: typeof kind === "string" ? kind : "" };
  }
  return {
    kind,
    pane: str(raw["pane"]),
    agentKind: str(raw["agentKind"]),
    agentName: str(raw["agentName"]),
    cwd: str(raw["cwd"]),
    session: str(raw["session"]),
    entryId: str(raw["entryId"]),
  };
};

const parseFingerprint = (value: unknown, text: string): Fingerprint => {
  if (typeof value !== "object" || value === null) return fingerprint(text);
  const raw = value as Record<string, unknown>;
  const sha256 = str(raw["sha256"]);
  const bytes = num(raw["bytes"]);
  const lines = num(raw["lines"]);
  if (sha256 === null || bytes === null || lines === null) return fingerprint(text);
  return { sha256, bytes, lines, head: str(raw["head"]) ?? "", tail: str(raw["tail"]) ?? "" };
};

/**
 * An excerpt from a stored record, or null when the record cannot carry one.
 * `id` and `text` are the only load-bearing fields; everything else is
 * reconstructed rather than rejected, so a partial write degrades to a
 * renderable excerpt instead of a lost one.
 */
export const parseExcerpt = (value: unknown): Excerpt | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const id = str(raw["id"]);
  const text = str(raw["text"]);
  if (id === null || text === null) return null;
  return {
    schemaVersion: 1,
    id,
    ts: str(raw["ts"]) ?? "",
    text,
    origin: parseOrigin(raw["origin"]) ?? { kind: "unknown", raw: "" },
    fingerprint: parseFingerprint(raw["fingerprint"], text),
  };
};
