// Reading Claude Code's session transcript.
//
// The screen is a lossy render of the transcript, which is why the transcript
// is a first-class source rather than a nicety. A Claude pane runs on the
// alternate screen, so tmux holds no scrollback for it at all, and Claude also
// elides on screen (`… +42 lines`) - so even the one visible screenful is
// lossy. The untruncated text only exists here.
//
// This format is not a documented contract. Parsing is tolerant throughout: a
// shape change degrades the transcript source rather than breaking selection
// capture, which is the source that must never stop working.
//
// Untruncation needs no late binding. Reading the entry at CAPTURE time and
// storing it verbatim gets the full text with none of the costs of resolving
// an address at render time.

/** Claude slugs every non-alphanumeric character, dots included. */
export const projectSlug = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, "-");

/** `<config-dir>/projects/<slug>/<sessionId>.jsonl`. */
export const transcriptPath = (configDir: string, cwd: string, sessionId: string): string =>
  `${configDir}/projects/${projectSlug(cwd)}/${sessionId}.jsonl`;

export type EntryRole = "user" | "assistant";

export interface TranscriptEntry {
  readonly uuid: string;
  /** ISO-8601 as the transcript records it; "" when absent. */
  readonly ts: string;
  readonly role: EntryRole;
  /** Every renderable block flattened and joined, verbatim. */
  readonly text: string;
  /** Block kinds present, in order, for the picker's label. */
  readonly blocks: readonly string[];
}

export interface Transcript {
  readonly entries: readonly TranscriptEntry[];
  /** Lines the parser could not use. Reported, never fatal. */
  readonly malformed: number;
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * The text a content block contributes.
 *
 * `thinking` and `tool_use` are labelled rather than dropped: a correction is
 * often about what the agent was reasoning towards, or the arguments it
 * passed, and an unlabelled splice of the two would read as prose it wrote.
 */
const blockText = (block: Record<string, unknown>): string | null => {
  switch (block["type"]) {
    case "text":
      return str(block["text"]);
    case "thinking": {
      const thinking = str(block["thinking"]);
      return thinking === null ? null : `[thinking]\n${thinking}`;
    }
    case "tool_use": {
      const name = str(block["name"]) ?? "tool";
      const input = block["input"];
      return `[tool_use: ${name}]\n${input === undefined ? "" : safeStringify(input)}`;
    }
    case "tool_result": {
      const content = block["content"];
      if (typeof content === "string") return `[tool_result]\n${content}`;
      // A tool result can itself be a block array.
      if (Array.isArray(content)) {
        const parts = content
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .map((item) => str(item["text"]))
          .filter((text): text is string => text !== null);
        return parts.length > 0 ? `[tool_result]\n${parts.join("\n")}` : null;
      }
      return null;
    }
    // A block type this build does not know. Skipped rather than guessed at.
    default:
      return null;
  }
};

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return "";
  }
};

const blockKind = (block: Record<string, unknown>): string => str(block["type"]) ?? "unknown";

/** One entry from one JSONL line, or null when the line does not carry one. */
export const parseEntry = (line: string): TranscriptEntry | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as Record<string, unknown>;

  // Only conversation turns. The file also carries mode changes, attachments,
  // titles and file-history snapshots, none of which is quotable.
  const type = raw["type"];
  if (type !== "user" && type !== "assistant") return null;

  const uuid = str(raw["uuid"]);
  if (uuid === null) return null;

  const message = raw["message"];
  if (typeof message !== "object" || message === null) return null;
  const content = (message as Record<string, unknown>)["content"];

  let text: string;
  let blocks: string[];
  if (typeof content === "string") {
    text = content;
    blocks = ["text"];
  } else if (Array.isArray(content)) {
    const usable = content.filter(
      (block): block is Record<string, unknown> => typeof block === "object" && block !== null,
    );
    blocks = usable.map(blockKind);
    text = usable
      .map(blockText)
      .filter((part): part is string => part !== null)
      .join("\n\n");
  } else {
    return null;
  }

  if (text.trim().length === 0) return null;

  return { uuid, ts: str(raw["timestamp"]) ?? "", role: type, text, blocks };
};

/** Every quotable turn in a transcript file, oldest first. */
export const parseTranscript = (text: string): Transcript => {
  const entries: TranscriptEntry[] = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const entry = parseEntry(line);
    if (entry === null) {
      // A non-conversation record is not malformed - the file is full of them.
      // Only a line that is not JSON at all counts.
      if (!looksLikeJson(line)) malformed += 1;
      continue;
    }
    entries.push(entry);
  }
  return { entries, malformed };
};

const looksLikeJson = (line: string): boolean => {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
};

/** The entry with this uuid, or null. */
export const findEntry = (
  transcript: Transcript,
  uuid: string,
): TranscriptEntry | null => transcript.entries.find((entry) => entry.uuid === uuid) ?? null;

/** One line per entry for the picker: uuid first, hidden by `--with-nth=2..`. */
export const pickerRows = (transcript: Transcript, width = 100): string[] =>
  transcript.entries.map((entry) => {
    const label = entry.role === "user" ? "you" : "agent";
    const kinds = [...new Set(entry.blocks)].join("+");
    const preview = entry.text.replace(/\s+/g, " ").trim().slice(0, width);
    return `${entry.uuid}\t${label}  ${kinds}  ${preview}`;
  });
