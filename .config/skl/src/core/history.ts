// Pure usage-history logic: build one JSONL record per successful load, and
// summarise a history file into per-skill usage counts. All ambient state
// (clock, file path, file contents) stays in the shell — `ts` and the file
// text arrive as parameters.

import type { DiscoveredSkill } from "./types.ts";

/** One usage-history record: a single successful load, as one JSONL line. */
export interface HistoryRecord {
  readonly schema_version: 1;
  /** ISO-8601 UTC timestamp of the load. */
  readonly ts: string;
  readonly source: string;
  readonly name: string;
  readonly mode: "inject" | "copy";
  /** tmux pane the pointer landed in; null for clipboard copies. */
  readonly target: string | null;
  readonly submit: boolean;
}

/** Build the JSONL line (record + trailing newline) for one successful load. */
export const historyLine = (
  skill: DiscoveredSkill,
  mode: "inject" | "copy",
  target: string | null,
  submit: boolean,
  ts: string,
): string => {
  const record: HistoryRecord = {
    schema_version: 1,
    ts,
    source: skill.source.name,
    name: skill.name,
    mode,
    target,
    submit,
  };
  return `${JSON.stringify(record)}\n`;
};

/** Per-skill usage summary: identity ref, load count, latest timestamp. */
export interface HistorySummaryRow {
  readonly ref: string;
  readonly count: number;
  /** Latest `ts` seen for this ref; `""` if no record carried one. */
  readonly last: string;
}

// The file accretes across schema changes and interrupted writes, so parsing
// is tolerant: blank or malformed lines are skipped, never an error.
export const summariseHistory = (text: string): HistorySummaryRow[] => {
  const byRef = new Map<string, { count: number; last: string }>();
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    const source = record["source"];
    const name = record["name"];
    if (typeof source !== "string" || typeof name !== "string") continue;
    // ISO-8601 UTC strings order lexicographically, so string max = latest.
    const ts = typeof record["ts"] === "string" ? record["ts"] : "";
    const ref = `${source}/${name}`;
    const entry = byRef.get(ref);
    if (entry === undefined) byRef.set(ref, { count: 1, last: ts });
    else {
      entry.count += 1;
      if (ts > entry.last) entry.last = ts;
    }
  }
  return [...byRef.entries()]
    .map(([ref, { count, last }]) => ({ ref, count, last }))
    .sort((a, b) => b.count - a.count || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
};

/** Render rows as aligned lines: `42  vendor/grilling  last 2026-07-16`. */
export const renderHistory = (rows: readonly HistorySummaryRow[]): string[] => {
  const width = rows.reduce((w, r) => Math.max(w, String(r.count).length), 1);
  return rows.map((r) => {
    const date = r.last.slice(0, 10);
    const suffix = date.length > 0 ? `  last ${date}` : "";
    return `${String(r.count).padStart(width)}  ${r.ref}${suffix}`;
  });
};
