import { describe, expect, test } from "bun:test";
import { captureExcerpt, emptyOrigin, type Excerpt, type Origin } from "./excerpt.ts";
import {
  appendable,
  COMMENT_PLACEHOLDER,
  DRAFT_PREAMBLE,
  formatList,
  listRows,
  originLabel,
  renderDraft,
  tildify,
  updateDraft,
} from "./render.ts";

const make = (ms: number, text: string, origin?: Partial<Origin>): Excerpt => {
  const made = captureExcerpt(
    text,
    { ...emptyOrigin("selection"), ...origin },
    { now: ms, random: (ms % 97) / 97 },
  );
  if (!made.ok) throw new Error("fixture excerpt should be valid");
  return made.value;
};

/** The id at `index`, asserted present - fixtures always are. */
const idOf = (spool: readonly Excerpt[], index: number): string => {
  const excerpt = spool[index];
  if (excerpt === undefined) throw new Error(`no fixture excerpt at ${index}`);
  return excerpt.id;
};

describe("tildify", () => {
  test("shortens the home prefix only at a path boundary", () => {
    expect(tildify("/Users/me/src/x", "/Users/me")).toBe("~/src/x");
    expect(tildify("/Users/me", "/Users/me")).toBe("~");
    expect(tildify("/Users/menagerie", "/Users/me")).toBe("/Users/menagerie");
  });

  test("with no home given, the path is left alone", () => {
    expect(tildify("/Users/me/src")).toBe("/Users/me/src");
  });
});

describe("originLabel", () => {
  test("prefers the agent's name, then its kind, then the source", () => {
    expect(originLabel({ ...emptyOrigin("selection"), agentName: "reviewer", agentKind: "claude" })).toContain(
      "reviewer",
    );
    expect(originLabel({ ...emptyOrigin("selection"), agentKind: "codex" })).toContain("codex");
    expect(originLabel(emptyOrigin("pane"))).toBe("pane");
  });

  test("names pane and cwd when they are known", () => {
    const label = originLabel(
      { ...emptyOrigin("selection"), agentKind: "codex", pane: "%417", cwd: "/Users/me/src/x" },
      "/Users/me",
    );
    expect(label).toBe("codex · `%417` · ~/src/x");
  });

  test("an unrecognised source still gets a heading", () => {
    expect(originLabel({ kind: "unknown", raw: "hologram" })).toBe("hologram (unrecognised source)");
    expect(originLabel({ kind: "unknown", raw: "" })).toBe("unrecognised source");
  });
});

describe("renderDraft", () => {
  test("leads with the preamble and numbers each excerpt", () => {
    const markdown = renderDraft([make(1, "first"), make(2, "second")]);
    expect(markdown.startsWith(DRAFT_PREAMBLE)).toBe(true);
    expect(markdown).toContain("## 1 · selection");
    expect(markdown).toContain("## 2 · selection");
  });

  test("leaves a placeholder to write the comment into", () => {
    expect(renderDraft([make(1, "x")])).toContain(COMMENT_PLACEHOLDER);
  });

  test("the fence survives backticks in the excerpt", () => {
    const markdown = renderDraft([make(1, "before\n```\nfenced\n```\nafter")]);
    expect(markdown).toContain("````text");
    // The inner fence must not be able to close the outer one.
    expect(markdown).toContain("\n```\nfenced\n```\n");
  });

  test("the excerpt text is reproduced verbatim", () => {
    const text = "  indented\n\tand tabbed  \n\nblank line above";
    expect(renderDraft([make(1, text)])).toContain(text);
  });
});

describe("appendable", () => {
  test("with nothing rendered yet, everything is appendable", () => {
    const spool = [make(1, "a"), make(2, "b")];
    expect(appendable(spool, null)).toEqual(spool);
  });

  test("only what follows the rendered excerpt", () => {
    const spool = [make(1, "a"), make(2, "b"), make(3, "c")];
    expect(appendable(spool, idOf(spool, 1)).map((e) => e.text)).toEqual(["c"]);
  });

  test("nothing when the newest excerpt is already rendered", () => {
    const spool = [make(1, "a"), make(2, "b")];
    expect(appendable(spool, idOf(spool, 1))).toEqual([]);
  });

  // The rendered excerpt can be dropped between renders, so position lookup
  // fails and the id ordering has to carry it.
  test("falls back to id order when the rendered excerpt has been dropped", () => {
    const dropped = make(2, "gone");
    const spool = [make(1, "a"), make(3, "c")];
    expect(appendable(spool, dropped.id).map((e) => e.text)).toEqual(["c"]);
  });
});

describe("updateDraft", () => {
  test("with no draft, renders the whole spool", () => {
    const spool = [make(1, "a"), make(2, "b")];
    const update = updateDraft(spool, null, null);
    expect(update.added).toBe(2);
    expect(update.renderedThrough).toBe(idOf(spool, 1));
    expect(update.markdown).toContain("## 2 ·");
  });

  test("appends only what is new, and keeps comments already written", () => {
    const spool = [make(1, "a"), make(2, "b")];
    const first = updateDraft(spool.slice(0, 1), null, null);
    const commented = first.markdown.replace(COMMENT_PLACEHOLDER, "this bit is wrong");
    const second = updateDraft(spool, commented, first.renderedThrough);

    expect(second.added).toBe(1);
    expect(second.markdown).toContain("this bit is wrong");
    expect(second.markdown).toContain("## 2 ·");
    // The re-render must not duplicate the excerpt already in the draft.
    expect(second.markdown.match(/## 1 ·/g)).toHaveLength(1);
    expect(second.markdown).not.toContain(COMMENT_PLACEHOLDER.repeat(2));
  });

  test("numbering continues rather than restarting", () => {
    const spool = [make(1, "a"), make(2, "b"), make(3, "c")];
    const first = updateDraft(spool.slice(0, 2), null, null);
    const second = updateDraft(spool, first.markdown, first.renderedThrough);
    expect(second.markdown).toContain("## 3 ·");
    expect(second.markdown).not.toContain("## 1 · selection\n\n```text\nc");
  });

  test("with nothing new, the draft is returned untouched", () => {
    const spool = [make(1, "a")];
    const first = updateDraft(spool, null, null);
    const again = updateDraft(spool, first.markdown, first.renderedThrough);
    expect(again.added).toBe(0);
    expect(again.markdown).toBe(first.markdown);
    expect(again.renderedThrough).toBe(first.renderedThrough);
  });

  test("re-rendering repeatedly never duplicates an excerpt", () => {
    const spool = [make(1, "a"), make(2, "b")];
    let markdown = renderDraft(spool.slice(0, 1));
    let through: string | null = idOf(spool, 0);
    for (let i = 0; i < 5; i += 1) {
      const update = updateDraft(spool, markdown, through);
      markdown = update.markdown;
      through = update.renderedThrough;
    }
    expect(markdown.match(/## \d+ ·/g)).toHaveLength(2);
  });
});

describe("listRows", () => {
  test("numbers from one and previews the first non-blank line", () => {
    const rows = listRows([make(1, "\n\nfirst real line\nsecond")]);
    expect(rows[0]?.index).toBe(1);
    expect(rows[0]?.preview).toBe("first real line");
    expect(rows[0]?.lines).toBe(4);
  });

  test("formats one row per excerpt", () => {
    expect(formatList(listRows([make(1, "a"), make(2, "b")])).split("\n")).toHaveLength(2);
  });
});
