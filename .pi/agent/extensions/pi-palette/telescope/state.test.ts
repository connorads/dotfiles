import { describe, it, expect } from "vitest";
import {
  initialState,
  reduce,
  type TelescopeState,
} from "./state.js";
import type { ScoredItem } from "./types.js";

function makeScoredItems(labels: string[]): ScoredItem<string>[] {
  return labels.map((item, i) => ({ item, score: labels.length - i, indices: [] }));
}

function stateWith(items: string[]): TelescopeState<string> {
  const scored = makeScoredItems(items);
  return initialState(scored);
}

// ── initialState ───────────────────────────────────────

describe("initialState", () => {
  it("starts with empty query and selection at 0", () => {
    const state = stateWith(["a", "b", "c"]);
    expect(state.query).toBe("");
    expect(state.selectedIndex).toBe(0);
    expect(state.scrollOffset).toBe(0);
    expect(state.mode).toBe("search");
  });

  it("handles empty items", () => {
    const state = stateWith([]);
    expect(state.filtered).toHaveLength(0);
    expect(state.selectedIndex).toBe(0);
  });
});

// ── Navigation ─────────────────────────────────────────

describe("navigation", () => {
  it("moveDown increments selectedIndex", () => {
    const s = stateWith(["a", "b", "c"]);
    const next = reduce(s, { type: "moveDown" });
    expect(next.selectedIndex).toBe(1);
  });

  it("moveDown clamps at end", () => {
    let s = stateWith(["a", "b"]);
    s = reduce(s, { type: "moveDown" });
    s = reduce(s, { type: "moveDown" });
    s = reduce(s, { type: "moveDown" });
    expect(s.selectedIndex).toBe(1);
  });

  it("moveUp decrements selectedIndex", () => {
    let s = stateWith(["a", "b", "c"]);
    s = reduce(s, { type: "moveDown" });
    s = reduce(s, { type: "moveUp" });
    expect(s.selectedIndex).toBe(0);
  });

  it("moveUp clamps at start", () => {
    const s = stateWith(["a", "b"]);
    const next = reduce(s, { type: "moveUp" });
    expect(next.selectedIndex).toBe(0);
  });

  it("pageDown jumps by 10", () => {
    const items = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    const s = stateWith(items);
    const next = reduce(s, { type: "pageDown" });
    expect(next.selectedIndex).toBe(10);
  });

  it("pageUp jumps back by 10", () => {
    const items = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    let s = stateWith(items);
    s = reduce(s, { type: "pageDown" });
    s = reduce(s, { type: "pageDown" });
    s = reduce(s, { type: "pageUp" });
    expect(s.selectedIndex).toBe(10);
  });
});

// ── Typing ─────────────────────────────────────────────

describe("typing", () => {
  it("appends character to query", () => {
    const s = stateWith(["abc", "def"]);
    const next = reduce(s, { type: "type", char: "a" });
    expect(next.query).toBe("a");
    expect(next.cursorPos).toBe(1);
  });

  it("backspace removes last character", () => {
    let s = stateWith(["abc", "def"]);
    s = reduce(s, { type: "type", char: "a" });
    s = reduce(s, { type: "type", char: "b" });
    s = reduce(s, { type: "backspace" });
    expect(s.query).toBe("a");
    expect(s.cursorPos).toBe(1);
  });

  it("backspace on empty query is no-op", () => {
    const s = stateWith(["abc"]);
    const next = reduce(s, { type: "backspace" });
    expect(next.query).toBe("");
    expect(next.cursorPos).toBe(0);
  });

  it("deleteWord removes last word", () => {
    let s = stateWith(["abc"]);
    s = reduce(s, { type: "type", char: "h" });
    s = reduce(s, { type: "type", char: "i" });
    s = reduce(s, { type: "type", char: " " });
    s = reduce(s, { type: "type", char: "t" });
    s = reduce(s, { type: "deleteWord" });
    expect(s.query).toBe("hi ");
  });

  it("typing resets selectedIndex to 0", () => {
    let s = stateWith(["abc", "def", "ghi"]);
    s = reduce(s, { type: "moveDown" });
    s = reduce(s, { type: "moveDown" });
    expect(s.selectedIndex).toBe(2);
    s = reduce(s, { type: "type", char: "a" });
    expect(s.selectedIndex).toBe(0);
  });
});

// ── Selection ──────────────────────────────────────────

describe("selection", () => {
  it("select returns current item", () => {
    const s = stateWith(["abc", "def"]);
    const next = reduce(s, { type: "select" });
    expect(next.selectedItem).toBe("abc");
  });

  it("select after navigation returns correct item", () => {
    let s = stateWith(["abc", "def"]);
    s = reduce(s, { type: "moveDown" });
    s = reduce(s, { type: "select" });
    expect(s.selectedItem).toBe("def");
  });

  it("select with empty list returns undefined", () => {
    const s = stateWith([]);
    const next = reduce(s, { type: "select" });
    expect(next.selectedItem).toBeUndefined();
  });
});

// ── Cancel ─────────────────────────────────────────────

describe("cancel", () => {
  it("sets cancelled flag", () => {
    const s = stateWith(["abc"]);
    const next = reduce(s, { type: "cancel" });
    expect(next.cancelled).toBe(true);
  });
});

// ── Multi-select ───────────────────────────────────────

describe("toggleSelect", () => {
  it("toggles item into selectedKeys", () => {
    const s = stateWith(["abc", "def"]);
    const next = reduce(s, { type: "toggleSelect" });
    expect(next.selectedKeys.has("abc")).toBe(true);
    expect(next.selectedIndex).toBe(1); // advances
  });

  it("toggles item out of selectedKeys", () => {
    let s = stateWith(["abc", "def"]);
    s = reduce(s, { type: "toggleSelect" });
    // go back up
    s = reduce(s, { type: "moveUp" });
    s = reduce(s, { type: "toggleSelect" });
    expect(s.selectedKeys.has("abc")).toBe(false);
  });
});

// ── Preview toggle ─────────────────────────────────────

describe("togglePreview", () => {
  it("toggles showPreview", () => {
    const s = stateWith(["abc"]);
    expect(s.showPreview).toBe(true);
    const next = reduce(s, { type: "togglePreview" });
    expect(next.showPreview).toBe(false);
    const again = reduce(next, { type: "togglePreview" });
    expect(again.showPreview).toBe(true);
  });
});

// ── setFiltered ────────────────────────────────────────

describe("setFiltered", () => {
  it("replaces filtered items and resets selection", () => {
    let s = stateWith(["abc", "def", "ghi"]);
    s = reduce(s, { type: "moveDown" });
    const newFiltered = makeScoredItems(["xyz"]);
    s = reduce(s, { type: "setFiltered", filtered: newFiltered });
    expect(s.filtered).toHaveLength(1);
    expect(s.selectedIndex).toBe(0);
    expect(s.scrollOffset).toBe(0);
  });
});
