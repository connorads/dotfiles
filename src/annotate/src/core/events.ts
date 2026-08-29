// The append-only event log and the left fold that is the whole of state.
//
// Nothing in the log is ever rewritten. The spool is stashed-minus-dropped-
// minus-sent; the draft is the latest `drafted` since the last `sent`. `undo`
// is not a rewind - it appends a `drafted` carrying the last sent markdown,
// so the history stays a record of what happened.

import { parseExcerpt, type Excerpt } from "./excerpt.ts";

export interface StashedEvent {
  readonly kind: "stashed";
  readonly ts: string;
  readonly excerpt: Excerpt;
}

export interface DroppedEvent {
  readonly kind: "dropped";
  readonly ts: string;
  readonly excerptId: string;
}

export interface DraftedEvent {
  readonly kind: "drafted";
  readonly ts: string;
  readonly markdown: string;
  /** Id of the newest excerpt this draft already renders; null if none. */
  readonly renderedThrough: string | null;
}

export interface SentEvent {
  readonly kind: "sent";
  readonly ts: string;
  readonly markdown: string;
  /** Where it went: `agent:%12`, `clipboard`, or a file path. */
  readonly destination: string;
  readonly excerptIds: readonly string[];
}

export type Event = StashedEvent | DroppedEvent | DraftedEvent | SentEvent;

export interface Delivered {
  readonly markdown: string;
  readonly destination: string;
  readonly excerptIds: readonly string[];
}

export interface State {
  /** Excerpts waiting to be sent, in stash order. */
  readonly spool: readonly Excerpt[];
  /** The draft being written, or null when there is none. */
  readonly draft: string | null;
  readonly renderedThrough: string | null;
  /** The most recent successful delivery, which `undo` restores. */
  readonly lastSent: Delivered | null;
  /** Lines the parser could not use. Reported, never fatal. */
  readonly malformed: number;
}

export const emptyState: State = {
  spool: [],
  draft: null,
  renderedThrough: null,
  lastSent: null,
  malformed: 0,
};

export const eventLine = (event: Event): string => `${JSON.stringify(event)}\n`;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * One event from one JSONL line, or null when the line cannot carry one.
 *
 * Tolerant on purpose, copying `summariseHistory` in skl: the file accretes
 * across schema changes and interrupted writes, and a half-written final line
 * must not take the whole spool with it.
 */
export const parseEvent = (line: string): Event | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as Record<string, unknown>;
  const ts = str(raw["ts"]) ?? "";
  switch (raw["kind"]) {
    case "stashed": {
      const excerpt = parseExcerpt(raw["excerpt"]);
      return excerpt === null ? null : { kind: "stashed", ts, excerpt };
    }
    case "dropped": {
      const excerptId = str(raw["excerptId"]);
      return excerptId === null ? null : { kind: "dropped", ts, excerptId };
    }
    case "drafted": {
      const markdown = str(raw["markdown"]);
      return markdown === null
        ? null
        : { kind: "drafted", ts, markdown, renderedThrough: str(raw["renderedThrough"]) };
    }
    case "sent": {
      const markdown = str(raw["markdown"]);
      if (markdown === null) return null;
      const ids = raw["excerptIds"];
      return {
        kind: "sent",
        ts,
        markdown,
        destination: str(raw["destination"]) ?? "",
        excerptIds: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [],
      };
    }
    // An event kind this build does not know. Skipping it is the safe
    // degradation: it cannot be folded, but every other line still can.
    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

export const applyEvent = (state: State, event: Event): State => {
  switch (event.kind) {
    case "stashed":
      return { ...state, spool: [...state.spool, event.excerpt] };
    case "dropped":
      return { ...state, spool: state.spool.filter((e) => e.id !== event.excerptId) };
    case "drafted":
      return { ...state, draft: event.markdown, renderedThrough: event.renderedThrough };
    case "sent": {
      // Only the excerpts that were actually delivered leave the spool. One
      // stashed from another pane while the editor was open was never in the
      // draft, so it survives the send rather than being silently discarded.
      const sent = new Set(event.excerptIds);
      return {
        ...state,
        spool: state.spool.filter((e) => !sent.has(e.id)),
        draft: null,
        renderedThrough: null,
        lastSent: {
          markdown: event.markdown,
          destination: event.destination,
          excerptIds: event.excerptIds,
        },
      };
    }
  }
};

/** Fold a whole log file into state. Malformed lines are counted, not fatal. */
export const foldLog = (text: string): State => {
  let state = emptyState;
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const event = parseEvent(line);
    if (event === null) {
      malformed += 1;
      continue;
    }
    state = applyEvent(state, event);
  }
  return { ...state, malformed };
};
