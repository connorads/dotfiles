import { describe, expect, test } from "bun:test";
import {
  captureExcerpt,
  emptyOrigin,
  isSourceKind,
  MAX_EXCERPT_BYTES,
  parseExcerpt,
  parseOrigin,
} from "./excerpt.ts";

describe("captureExcerpt", () => {
  test("records the text verbatim, with provenance and a fingerprint", () => {
    const made = captureExcerpt(
      "  keep\tthis  \n",
      { ...emptyOrigin("selection"), pane: "%12", cwd: "/tmp" },
      { now: 1_700_000_000_000, random: 0.25 },
    );
    if (!made.ok) throw new Error("expected a capture");
    expect(made.value.text).toBe("  keep\tthis  \n");
    expect(made.value.origin).toMatchObject({ kind: "selection", pane: "%12", cwd: "/tmp" });
    expect(made.value.fingerprint.lines).toBe(1);
    expect(made.value.ts).toBe("2023-11-14T22:13:20.000Z");
  });

  test("whitespace-only text is an empty capture, not an excerpt", () => {
    const made = captureExcerpt("  \n\t\n", emptyOrigin("selection"), { now: 1, random: 0 });
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error.kind).toBe("empty");
  });

  test("refuses an excerpt past the per-capture ceiling", () => {
    const made = captureExcerpt("x".repeat(MAX_EXCERPT_BYTES + 1), emptyOrigin("pane"), {
      now: 1,
      random: 0,
    });
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error.kind).toBe("tooLarge");
  });

  test("ids sort in capture order", () => {
    const first = captureExcerpt("a", emptyOrigin("pane"), { now: 1_000, random: 0.9 });
    const second = captureExcerpt("b", emptyOrigin("pane"), { now: 2_000, random: 0.1 });
    if (!first.ok || !second.ok) throw new Error("expected captures");
    expect(second.value.id > first.value.id).toBe(true);
  });
});

describe("parseOrigin", () => {
  test("a known source keeps every field it carries", () => {
    expect(parseOrigin({ kind: "transcript", pane: "%1", entryId: "uuid" })).toEqual({
      kind: "transcript",
      pane: "%1",
      agentKind: null,
      agentName: null,
      cwd: null,
      session: null,
      entryId: "uuid",
    });
  });

  test("a source this build does not know widens to unknown", () => {
    expect(parseOrigin({ kind: "hologram" })).toEqual({ kind: "unknown", raw: "hologram" });
  });

  test("a field of the wrong type is dropped, not fatal", () => {
    expect(parseOrigin({ kind: "pane", pane: 42 })).toMatchObject({ kind: "pane", pane: null });
  });
});

describe("parseExcerpt", () => {
  test("id and text are the only load-bearing fields", () => {
    const excerpt = parseExcerpt({ id: "x", text: "body" });
    expect(excerpt).not.toBeNull();
    expect(excerpt?.fingerprint.lines).toBe(1);
    expect(excerpt?.origin).toEqual({ kind: "unknown", raw: "" });
  });

  test("a record with no text cannot carry an excerpt", () => {
    expect(parseExcerpt({ id: "x" })).toBeNull();
    expect(parseExcerpt(null)).toBeNull();
    expect(parseExcerpt("string")).toBeNull();
  });

  test("a broken fingerprint is recomputed rather than rejected", () => {
    const excerpt = parseExcerpt({ id: "x", text: "hello", fingerprint: { sha256: 12 } });
    expect(excerpt?.fingerprint.bytes).toBe(5);
  });
});

describe("isSourceKind", () => {
  test("only the three sources", () => {
    expect(isSourceKind("selection")).toBe(true);
    expect(isSourceKind("pane")).toBe(true);
    expect(isSourceKind("transcript")).toBe(true);
    expect(isSourceKind("clipboard")).toBe(false);
    expect(isSourceKind(7)).toBe(false);
  });
});
