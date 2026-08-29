import { describe, expect, test } from "bun:test";
import { captureExcerpt, emptyOrigin, type Excerpt } from "./excerpt.ts";
import { eventLine, foldLog, parseEvent, type Event } from "./events.ts";

const excerptAt = (ms: number, text: string, pane: string | null = "%1"): Excerpt => {
  const made = captureExcerpt(text, { ...emptyOrigin("selection"), pane }, { now: ms, random: 0.5 });
  if (!made.ok) throw new Error("fixture excerpt should be valid");
  return made.value;
};

const log = (...events: readonly Event[]): string => events.map(eventLine).join("");

describe("round trip", () => {
  test("every event kind survives write then read", () => {
    const excerpt = excerptAt(1_700_000_000_000, "hello");
    const events: Event[] = [
      { kind: "stashed", ts: "2026-01-01T00:00:00.000Z", excerpt },
      { kind: "dropped", ts: "2026-01-01T00:00:01.000Z", excerptId: "abc" },
      { kind: "drafted", ts: "2026-01-01T00:00:02.000Z", markdown: "# hi", renderedThrough: "abc" },
      {
        kind: "sent",
        ts: "2026-01-01T00:00:03.000Z",
        markdown: "# hi",
        destination: "agent:%1",
        excerptIds: ["abc", "def"],
      },
    ];
    for (const event of events) {
      expect(parseEvent(eventLine(event).trimEnd())).toEqual(event);
    }
  });
});

describe("tolerant parsing", () => {
  test("malformed lines are counted, never fatal", () => {
    const excerpt = excerptAt(1, "kept");
    const text =
      log({ kind: "stashed", ts: "t", excerpt }) + "not json at all\n" + "{broken\n" + "\n";
    const state = foldLog(text);
    expect(state.spool).toHaveLength(1);
    expect(state.malformed).toBe(2);
  });

  test("a truncated final line loses only itself", () => {
    const excerpt = excerptAt(1, "kept");
    const text = log({ kind: "stashed", ts: "t", excerpt }) + '{"kind":"stashed","ts":"t","exce';
    const state = foldLog(text);
    expect(state.spool.map((e) => e.text)).toEqual(["kept"]);
    expect(state.malformed).toBe(1);
  });

  test("an event kind this build does not know is skipped, not fatal", () => {
    const excerpt = excerptAt(1, "kept");
    const text =
      '{"kind":"teleported","ts":"t","somewhere":"else"}\n' + log({ kind: "stashed", ts: "t", excerpt });
    const state = foldLog(text);
    expect(state.spool).toHaveLength(1);
    expect(state.malformed).toBe(1);
  });

  test("an excerpt with an unrecognised source still folds, under unknown", () => {
    const text =
      '{"kind":"stashed","ts":"t","excerpt":{"id":"z","text":"future","origin":{"kind":"hologram"}}}\n';
    const state = foldLog(text);
    expect(state.malformed).toBe(0);
    expect(state.spool).toHaveLength(1);
    expect(state.spool[0]?.origin).toEqual({ kind: "unknown", raw: "hologram" });
  });

  test("an empty log is empty state", () => {
    expect(foldLog("")).toEqual({
      spool: [],
      draft: null,
      renderedThrough: null,
      lastSent: null,
      malformed: 0,
    });
  });
});

describe("the fold", () => {
  test("the spool is stashed minus dropped", () => {
    const a = excerptAt(1, "a");
    const b = excerptAt(2, "b");
    const state = foldLog(
      log(
        { kind: "stashed", ts: "t", excerpt: a },
        { kind: "stashed", ts: "t", excerpt: b },
        { kind: "dropped", ts: "t", excerptId: a.id },
      ),
    );
    expect(state.spool.map((e) => e.text)).toEqual(["b"]);
  });

  test("drafted is last-write-wins", () => {
    const state = foldLog(
      log(
        { kind: "drafted", ts: "t", markdown: "first", renderedThrough: null },
        { kind: "drafted", ts: "t", markdown: "second", renderedThrough: "x" },
      ),
    );
    expect(state.draft).toBe("second");
    expect(state.renderedThrough).toBe("x");
  });

  test("sent clears the draft and records what to undo to", () => {
    const a = excerptAt(1, "a");
    const state = foldLog(
      log(
        { kind: "stashed", ts: "t", excerpt: a },
        { kind: "drafted", ts: "t", markdown: "body", renderedThrough: a.id },
        { kind: "sent", ts: "t", markdown: "body", destination: "agent:%1", excerptIds: [a.id] },
      ),
    );
    expect(state.spool).toEqual([]);
    expect(state.draft).toBeNull();
    expect(state.renderedThrough).toBeNull();
    expect(state.lastSent).toEqual({
      markdown: "body",
      destination: "agent:%1",
      excerptIds: [a.id],
    });
  });

  // An excerpt stashed from another pane while the editor was open was never
  // in the draft, so the send must not take it with it.
  test("sent removes only the excerpts it delivered", () => {
    const a = excerptAt(1, "in the draft");
    const b = excerptAt(2, "stashed while editing");
    const state = foldLog(
      log(
        { kind: "stashed", ts: "t", excerpt: a },
        { kind: "stashed", ts: "t", excerpt: b },
        { kind: "sent", ts: "t", markdown: "body", destination: "agent:%1", excerptIds: [a.id] },
      ),
    );
    expect(state.spool.map((e) => e.text)).toEqual(["stashed while editing"]);
  });

  test("undo is an append: a later drafted restores the sent markdown", () => {
    const a = excerptAt(1, "a");
    const state = foldLog(
      log(
        { kind: "stashed", ts: "t", excerpt: a },
        { kind: "sent", ts: "t", markdown: "delivered", destination: "agent:%1", excerptIds: [a.id] },
        { kind: "drafted", ts: "t", markdown: "delivered", renderedThrough: null },
      ),
    );
    expect(state.draft).toBe("delivered");
    expect(state.spool).toEqual([]);
    expect(state.lastSent?.markdown).toBe("delivered");
  });
});
