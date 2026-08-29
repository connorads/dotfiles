import { describe, expect, test } from "bun:test";
import { captureExcerpt, emptyOrigin, type Excerpt } from "./excerpt.ts";
import { dropTargets, resolveTarget } from "./spool.ts";

/** The id at `index`, asserted present - fixtures always are. */
const idOf = (spool: readonly Excerpt[], index: number): string => {
  const excerpt = spool[index];
  if (excerpt === undefined) throw new Error(`no fixture excerpt at ${index}`);
  return excerpt.id;
};

const make = (ms: number, pane: string | null): Excerpt => {
  const made = captureExcerpt("text", { ...emptyOrigin("selection"), pane }, { now: ms, random: 0.5 });
  if (!made.ok) throw new Error("fixture excerpt should be valid");
  return made.value;
};

describe("dropTargets", () => {
  const spool = [make(1, "%1"), make(2, "%2"), make(3, "%3")];

  test("an index is 1-based", () => {
    const targets = dropTargets(spool, { kind: "index", index: 2 });
    expect(targets.ok && targets.value).toEqual([idOf(spool, 1)]);
  });

  test("last is the newest", () => {
    const targets = dropTargets(spool, { kind: "last" });
    expect(targets.ok && targets.value).toEqual([idOf(spool, 2)]);
  });

  test("all is every excerpt", () => {
    const targets = dropTargets(spool, { kind: "all" });
    expect(targets.ok && targets.value).toHaveLength(3);
  });

  test("clearing an empty spool is fine; dropping from one is not", () => {
    expect(dropTargets([], { kind: "all" })).toEqual({ ok: true, value: [] });
    expect(dropTargets([], { kind: "last" }).ok).toBe(false);
  });

  test("an index past the end says how many there are", () => {
    const targets = dropTargets(spool, { kind: "index", index: 9 });
    expect(targets.ok).toBe(false);
    if (!targets.ok) expect(targets.error).toContain("spool holds 3");
  });
});

describe("resolveTarget", () => {
  test("--to wins over anything the spool implies", () => {
    expect(resolveTarget([make(1, "%1")], "%99")).toEqual({ kind: "explicit", pane: "%99" });
  });

  test("one distinct pane among the origins is unanimous", () => {
    expect(resolveTarget([make(1, "%7"), make(2, "%7")], null)).toEqual({
      kind: "unanimous",
      pane: "%7",
    });
  });

  test("several panes fall back to the most recent, and say which were seen", () => {
    const choice = resolveTarget([make(1, "%1"), make(2, "%2")], null);
    expect(choice).toEqual({ kind: "mostRecent", pane: "%2", panes: ["%1", "%2"] });
  });

  test("an empty spool, or origins with no pane, resolves to nothing", () => {
    expect(resolveTarget([], null)).toEqual({ kind: "none" });
    expect(resolveTarget([make(1, null)], null)).toEqual({ kind: "none" });
  });
});
