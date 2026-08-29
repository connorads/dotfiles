import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findEntry,
  parseEntry,
  parseTranscript,
  pickerRows,
  projectSlug,
  transcriptPath,
} from "./transcript.ts";

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "..", "..", "tests", "fixtures", name), "utf8");

const transcript = parseTranscript(fixture("transcript.jsonl"));

describe("projectSlug", () => {
  test("slugs every non-alphanumeric character, dots included", () => {
    expect(projectSlug("/Users/me/proj")).toBe("-Users-me-proj");
    expect(projectSlug("/Users/me/.trees/x")).toBe("-Users-me--trees-x");
  });

  test("builds the path the resolver's sibling reads", () => {
    expect(transcriptPath("/h/.claude", "/Users/me/proj", "abc-123")).toBe(
      "/h/.claude/projects/-Users-me-proj/abc-123.jsonl",
    );
  });
});

describe("parseTranscript", () => {
  test("keeps conversation turns and drops the rest", () => {
    // The file also carries mode changes, attachments, titles and snapshots.
    expect(transcript.entries.map((e) => e.uuid)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(transcript.malformed).toBe(0);
  });

  test("a string content turn is one text block", () => {
    const entry = findEntry(transcript, "u1");
    expect(entry?.role).toBe("user");
    expect(entry?.text).toBe("please fix the parser");
  });

  test("a multi-block turn keeps every block, labelled", () => {
    const entry = findEntry(transcript, "a1");
    expect(entry?.blocks).toEqual(["thinking", "text", "tool_use"]);
    expect(entry?.text).toContain("[thinking]");
    expect(entry?.text).toContain("The parser drops the final line.");
    expect(entry?.text).toContain("I'll fix the off-by-one in the line splitter.");
    expect(entry?.text).toContain("[tool_use: Edit]");
    expect(entry?.text).toContain("parse.ts");
  });

  test("a tool result is quotable and labelled", () => {
    const entry = findEntry(transcript, "u2");
    expect(entry?.text).toContain("[tool_result]");
    expect(entry?.text).toContain("line one\nline two");
  });

  // The reason the transcript source exists: the screen shows `… +42 lines`,
  // the transcript holds all 60.
  test("a long turn comes back untruncated", () => {
    const entry = findEntry(transcript, "a2");
    expect(entry?.text.split("\n")).toHaveLength(60);
    expect(entry?.text).toContain("detail line 60");
    expect(entry?.text).not.toContain("+42 lines");
  });

  test("a turn with nothing quotable is not an entry", () => {
    expect(findEntry(transcript, "a3")).toBeNull();
  });

  test("timestamps are carried through", () => {
    expect(findEntry(transcript, "u1")?.ts).toBe("2026-08-29T10:00:00.000Z");
  });
});

describe("tolerance", () => {
  // The format is not a documented contract, so a shape change has to degrade
  // the transcript source rather than break capture.
  test("a non-JSON line and a truncated final line cost only themselves", () => {
    const corrupt = parseTranscript(fixture("transcript-corrupt.jsonl"));
    expect(corrupt.entries.map((e) => e.uuid)).toEqual(["u1", "a1"]);
    expect(corrupt.malformed).toBe(2);
  });

  test("a non-conversation record is skipped without counting as malformed", () => {
    const parsed = parseTranscript('{"type":"ai-title","title":"x"}\n');
    expect(parsed.entries).toEqual([]);
    expect(parsed.malformed).toBe(0);
  });

  test("an unknown block type is skipped, and its siblings survive", () => {
    const entry = parseEntry(
      JSON.stringify({
        type: "assistant",
        uuid: "z",
        message: {
          role: "assistant",
          content: [
            { type: "hologram", payload: "???" },
            { type: "text", text: "still here" },
          ],
        },
      }),
    );
    expect(entry?.text).toBe("still here");
    expect(entry?.blocks).toEqual(["hologram", "text"]);
  });

  test("a turn with no uuid cannot be addressed, so it is not an entry", () => {
    expect(parseEntry('{"type":"user","message":{"role":"user","content":"hi"}}')).toBeNull();
  });

  test("junk of every shape returns null rather than throwing", () => {
    for (const line of ["", "null", "[]", '"a string"', "{}", '{"type":"user"}']) {
      expect(parseEntry(line)).toBeNull();
    }
  });
});

describe("pickerRows", () => {
  test("hides the uuid in field 1 and previews on one line", () => {
    const rows = pickerRows(transcript);
    expect(rows).toHaveLength(4);
    const [uuid, label] = (rows[0] as string).split("\t");
    expect(uuid).toBe("u1");
    expect(label).toContain("you");
    expect(label).toContain("please fix the parser");
  });

  test("a multi-line turn collapses to a single row", () => {
    const row = pickerRows(transcript).find((r) => r.startsWith("a2")) as string;
    expect(row).not.toContain("\n");
    expect(row).toContain("agent");
  });
});
