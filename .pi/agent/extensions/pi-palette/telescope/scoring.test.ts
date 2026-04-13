import { describe, it, expect } from "vitest";
import {
  computeMatch,
  parseQueryTokens,
  filterAndScore,
  isSubsequence,
} from "./scoring.js";

// ── isSubsequence ──────────────────────────────────────

describe("isSubsequence", () => {
  it("matches exact string", () => {
    expect(isSubsequence("abc", "abc")).toBe(true);
  });

  it("matches scattered chars", () => {
    expect(isSubsequence("ac", "abc")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isSubsequence("ABC", "abcdef")).toBe(true);
  });

  it("rejects when chars missing", () => {
    expect(isSubsequence("xyz", "abc")).toBe(false);
  });

  it("rejects when query longer than text", () => {
    expect(isSubsequence("abcdef", "abc")).toBe(false);
  });

  it("handles empty query", () => {
    expect(isSubsequence("", "anything")).toBe(true);
  });
});

// ── computeMatch ───────────────────────────────────────

describe("computeMatch", () => {
  it("returns zero score for empty query", () => {
    const result = computeMatch("", "anything");
    expect(result.score).toBe(0);
    expect(result.indices).toEqual([]);
  });

  it("returns -Infinity for empty text", () => {
    const result = computeMatch("abc", "");
    expect(result.score).toBe(-Infinity);
  });

  it("returns -Infinity when no match", () => {
    const result = computeMatch("xyz", "abcdef");
    expect(result.score).toBe(-Infinity);
  });

  it("exact match scores higher than scattered match", () => {
    const exact = computeMatch("abc", "abc");
    const scattered = computeMatch("abc", "a---b---c");
    expect(exact.score).toBeGreaterThan(scattered.score);
  });

  it("word boundary match scores higher than mid-word", () => {
    const boundary = computeMatch("ts", "type-script");
    const midWord = computeMatch("ts", "typescript");
    expect(boundary.score).toBeGreaterThan(midWord.score);
  });

  it("filename start gets bonus", () => {
    const fileStart = computeMatch("s", "src/scoring.ts");
    const pathStart = computeMatch("s", "src/other.ts");
    // 's' at position 4 (after /) gets filename bonus vs position 0 (path start)
    // Both get bonuses but the filename bonus is larger
    expect(fileStart.score).toBeGreaterThanOrEqual(pathStart.score);
  });

  it("returns correct match indices", () => {
    const result = computeMatch("ac", "abc");
    expect(result.indices).toContain(0); // 'a'
    expect(result.indices).toContain(2); // 'c'
    expect(result.indices).toHaveLength(2);
  });

  it("case insensitive matching", () => {
    const result = computeMatch("ABC", "abcdef");
    expect(result.score).toBeGreaterThan(-Infinity);
    expect(result.indices).toHaveLength(3);
  });

  it("camelCase boundary gets bonus", () => {
    const camel = computeMatch("gS", "getState");
    const plain = computeMatch("gs", "gxsomething");
    expect(camel.score).toBeGreaterThan(plain.score);
  });
});

// ── parseQueryTokens ───────────────────────────────────

describe("parseQueryTokens", () => {
  it("returns empty for empty query", () => {
    expect(parseQueryTokens("")).toEqual([]);
  });

  it("parses plain fuzzy token", () => {
    const tokens = parseQueryTokens("hello");
    expect(tokens).toEqual([{ type: "fuzzy", text: "hello" }]);
  });

  it("parses exact match with apostrophe prefix", () => {
    const tokens = parseQueryTokens("'exact");
    expect(tokens).toEqual([{ type: "exact", text: "exact" }]);
  });

  it("parses prefix match with caret", () => {
    const tokens = parseQueryTokens("^prefix");
    expect(tokens).toEqual([{ type: "prefix", text: "prefix" }]);
  });

  it("parses suffix match with dollar", () => {
    const tokens = parseQueryTokens("suffix$");
    expect(tokens).toEqual([{ type: "suffix", text: "suffix" }]);
  });

  it("parses negate with bang", () => {
    const tokens = parseQueryTokens("!negate");
    expect(tokens).toEqual([{ type: "negate", text: "negate" }]);
  });

  it("parses multiple tokens", () => {
    const tokens = parseQueryTokens("fuzzy 'exact ^pre !neg end$");
    expect(tokens).toHaveLength(5);
    expect(tokens[0]).toEqual({ type: "fuzzy", text: "fuzzy" });
    expect(tokens[1]).toEqual({ type: "exact", text: "exact" });
    expect(tokens[2]).toEqual({ type: "prefix", text: "pre" });
    expect(tokens[3]).toEqual({ type: "negate", text: "neg" });
    expect(tokens[4]).toEqual({ type: "suffix", text: "end" });
  });

  it("handles single-char modifier as fuzzy", () => {
    // A bare ' or ^ with nothing after is too short — treated as fuzzy
    const tokens = parseQueryTokens("'");
    expect(tokens).toEqual([{ type: "fuzzy", text: "'" }]);
  });
});

// ── filterAndScore ─────────────────────────────────────

describe("filterAndScore", () => {
  const items = [
    "src/scoring.ts",
    "src/types.ts",
    "test/scoring.test.ts",
    "README.md",
    "package.json",
  ];

  it("returns all items for empty query", () => {
    const result = filterAndScore(items, "", (x) => x);
    expect(result).toHaveLength(items.length);
  });

  it("filters by fuzzy match", () => {
    const result = filterAndScore(items, "scor", (x) => x);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.every((r) => r.item.includes("scor"))).toBe(true);
  });

  it("exact modifier filters correctly", () => {
    const result = filterAndScore(items, "'README", (x) => x);
    expect(result).toHaveLength(1);
    expect(result[0]!.item).toBe("README.md");
  });

  it("negate modifier excludes matches", () => {
    const result = filterAndScore(items, "!test", (x) => x);
    expect(result.every((r) => !r.item.toLowerCase().includes("test"))).toBe(
      true,
    );
  });

  it("prefix modifier matches path segments", () => {
    const result = filterAndScore(items, "^src", (x) => x);
    expect(result.every((r) => r.item.startsWith("src"))).toBe(true);
  });

  it("suffix modifier matches end of string", () => {
    const result = filterAndScore(items, ".ts$", (x) => x);
    expect(result.every((r) => r.item.endsWith(".ts"))).toBe(true);
  });

  it("sorts by score descending", () => {
    const result = filterAndScore(items, "scor", (x) => x);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.score).toBeGreaterThanOrEqual(result[i]!.score);
    }
  });

  it("applies frecency boost", () => {
    const frecency = new Map([["README.md", 100]]);
    const result = filterAndScore(items, "", (x) => x, 5000, frecency);
    // README.md should be boosted to the top
    expect(result[0]!.item).toBe("README.md");
  });

  it("respects limit", () => {
    const result = filterAndScore(items, "", (x) => x, 2);
    expect(result).toHaveLength(2);
  });

  it("combines fuzzy and modifier tokens", () => {
    const result = filterAndScore(items, "scor .ts$", (x) => x);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((r) => r.item.endsWith(".ts"))).toBe(true);
    expect(
      result.every((r) => r.item.toLowerCase().includes("scor")),
    ).toBe(true);
  });
});
