// Rendering the spool into the Markdown draft.
//
// The draft is what gets delivered - nothing parses Markdown back into
// records. Deleting a section drops it; the text that is saved is the text
// that is sent.

import type { Excerpt, StoredOrigin } from "./excerpt.ts";
import { ellipsise, fenceFor, firstLine } from "./text.ts";

/** Shown once at the top of a fresh draft. */
export const DRAFT_PREAMBLE = `<!-- annotate: write your correction under each excerpt.
     Delete a section to drop it. Save and quit to send it;
     quit without saving to keep the draft for later. -->`;

/** Replaced by the reader's comment; a section still holding it said nothing. */
export const COMMENT_PLACEHOLDER = "<!-- your comment here -->";

/** Where the excerpt came from, as a heading. */
export const originLabel = (origin: StoredOrigin, home?: string): string => {
  if (origin.kind === "unknown") {
    // Captured by a build that knows a source this one does not.
    return origin.raw.length > 0 ? `${origin.raw} (unrecognised source)` : "unrecognised source";
  }
  const who = origin.agentName ?? origin.agentKind ?? origin.kind;
  const parts = [who];
  if (origin.pane !== null) parts.push(`\`${origin.pane}\``);
  if (origin.cwd !== null) parts.push(tildify(origin.cwd, home));
  return parts.join(" · ");
};

/** `$HOME/x` as `~/x`, so a heading stays readable at terminal width. */
export const tildify = (path: string, home?: string): string => {
  const base = home ?? "";
  if (base.length > 0 && (path === base || path.startsWith(`${base}/`))) {
    return `~${path.slice(base.length)}`;
  }
  return path;
};

/** One excerpt as a numbered section: heading, fenced text, room to comment. */
export const renderExcerpt = (excerpt: Excerpt, index: number, home?: string): string => {
  const origin = originLabel(excerpt.origin, home);
  const fence = fenceFor(excerpt.text);
  const body = excerpt.text.endsWith("\n") ? excerpt.text.slice(0, -1) : excerpt.text;
  return [`## ${index} · ${origin}`, "", `${fence}text`, body, fence, "", COMMENT_PLACEHOLDER, ""].join(
    "\n",
  );
};

/** A run of excerpts as sections, numbered from `startIndex`. */
export const renderSections = (
  excerpts: readonly Excerpt[],
  startIndex: number,
  home?: string,
): string => excerpts.map((e, i) => renderExcerpt(e, startIndex + i, home)).join("\n");

/**
 * A fresh draft: preamble plus every excerpt in the spool.
 *
 * No excerpts means no draft, not a lone preamble. The preamble addresses the
 * reader, so a draft holding only that is empty in every sense that matters -
 * and callers test emptiness to decide whether there is anything to open an
 * editor on or send.
 */
export const renderDraft = (excerpts: readonly Excerpt[], home?: string): string =>
  excerpts.length === 0 ? "" : `${DRAFT_PREAMBLE}\n\n${renderSections(excerpts, 1, home)}`;

/**
 * The excerpts a draft does not yet render.
 *
 * Spool position is the primary rule: the draft was rendered from a prefix of
 * the spool, so everything after `renderedThrough` is new. Lexical id compare
 * is the fallback for when that excerpt has since been dropped - ids are
 * timestamp-prefixed and fixed-width, so string order is time order.
 */
export const appendable = (
  spool: readonly Excerpt[],
  renderedThrough: string | null,
): readonly Excerpt[] => {
  if (renderedThrough === null) return spool;
  const index = spool.findIndex((e) => e.id === renderedThrough);
  if (index >= 0) return spool.slice(index + 1);
  return spool.filter((e) => e.id > renderedThrough);
};

export interface DraftUpdate {
  readonly markdown: string;
  readonly renderedThrough: string | null;
  /** How many excerpts this render added; 0 means the draft is unchanged. */
  readonly added: number;
}

/**
 * The draft a `send` should open: a fresh render when there is none, otherwise
 * the existing draft with anything stashed since appended below. Comments
 * already written are never touched, and a re-render never duplicates an
 * excerpt.
 */
export const updateDraft = (
  spool: readonly Excerpt[],
  draft: string | null,
  renderedThrough: string | null,
  home?: string,
): DraftUpdate => {
  const newest = spool.length > 0 ? (spool[spool.length - 1] as Excerpt).id : renderedThrough;
  if (draft === null) {
    return { markdown: renderDraft(spool, home), renderedThrough: newest, added: spool.length };
  }
  const fresh = appendable(spool, renderedThrough);
  if (fresh.length === 0) return { markdown: draft, renderedThrough, added: 0 };
  const startIndex = spool.length - fresh.length + 1;
  const body = renderSections(fresh, startIndex, home);
  const separator = draft.endsWith("\n") ? "\n" : "\n\n";
  return { markdown: `${draft}${separator}${body}`, renderedThrough: newest, added: fresh.length };
};

// ---------------------------------------------------------------------------
// `annotate list`
// ---------------------------------------------------------------------------

export interface ListRow {
  readonly index: number;
  readonly id: string;
  readonly origin: string;
  readonly lines: number;
  readonly preview: string;
}

export const listRows = (spool: readonly Excerpt[], home?: string): ListRow[] =>
  spool.map((excerpt, i) => ({
    index: i + 1,
    id: excerpt.id,
    origin: originLabel(excerpt.origin, home),
    lines: excerpt.fingerprint.lines,
    preview: ellipsise(firstLine(excerpt.text), 60),
  }));

export const formatList = (rows: readonly ListRow[]): string =>
  rows
    .map((row) => `${String(row.index).padStart(2)}  ${row.origin}  (${row.lines}L)  ${row.preview}`)
    .join("\n");
