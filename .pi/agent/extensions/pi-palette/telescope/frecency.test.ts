import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordSelection,
  getFrecencyMap,
  computeFrecencyScore,
  pruneEntries,
  type FrecencyData,
  type FrecencyEntry,
} from "./frecency.js";

// ── computeFrecencyScore (pure) ────────────────────────

describe("computeFrecencyScore", () => {
  it("returns count when age is zero", () => {
    const entry: FrecencyEntry = { count: 5, lastUsed: Date.now() };
    const score = computeFrecencyScore(entry);
    expect(score).toBeCloseTo(5, 0);
  });

  it("halves after one half-life (7 days)", () => {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const entry: FrecencyEntry = {
      count: 10,
      lastUsed: Date.now() - sevenDaysMs,
    };
    const score = computeFrecencyScore(entry);
    expect(score).toBeCloseTo(5, 0);
  });

  it("decays to near-zero after many half-lives", () => {
    const sixtyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const entry: FrecencyEntry = {
      count: 10,
      lastUsed: Date.now() - sixtyDaysMs,
    };
    const score = computeFrecencyScore(entry);
    expect(score).toBeLessThan(0.01);
  });

  it("returns zero for zero count", () => {
    const entry: FrecencyEntry = { count: 0, lastUsed: Date.now() };
    expect(computeFrecencyScore(entry)).toBe(0);
  });
});

// ── pruneEntries (pure) ────────────────────────────────

describe("pruneEntries", () => {
  it("keeps entries under the limit", () => {
    const entries: Record<string, FrecencyEntry> = {
      a: { count: 5, lastUsed: Date.now() },
      b: { count: 3, lastUsed: Date.now() },
    };
    const result = pruneEntries(entries, 10);
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("prunes to limit keeping highest scoring", () => {
    const now = Date.now();
    const entries: Record<string, FrecencyEntry> = {
      high: { count: 100, lastUsed: now },
      medium: { count: 50, lastUsed: now },
      low: { count: 1, lastUsed: now - 30 * 24 * 60 * 60 * 1000 },
    };
    const result = pruneEntries(entries, 2);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result["high"]).toBeDefined();
    expect(result["medium"]).toBeDefined();
    expect(result["low"]).toBeUndefined();
  });

  it("handles empty entries", () => {
    const result = pruneEntries({}, 500);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ── recordSelection + getFrecencyMap (integration) ─────

describe("recordSelection + getFrecencyMap", () => {
  let data: FrecencyData;

  beforeEach(() => {
    data = {};
  });

  it("creates entry on first selection", () => {
    data = recordSelection(data, "commands", "model");
    const map = getFrecencyMap(data, "commands");
    expect(map.has("model")).toBe(true);
    expect(map.get("model")!).toBeGreaterThan(0);
  });

  it("increments count on repeated selection", () => {
    data = recordSelection(data, "commands", "model");
    const score1 = getFrecencyMap(data, "commands").get("model")!;
    data = recordSelection(data, "commands", "model");
    const score2 = getFrecencyMap(data, "commands").get("model")!;
    expect(score2).toBeGreaterThan(score1);
  });

  it("returns empty map for unknown provider", () => {
    const map = getFrecencyMap(data, "nonexistent");
    expect(map.size).toBe(0);
  });

  it("keeps providers separate", () => {
    data = recordSelection(data, "commands", "model");
    data = recordSelection(data, "files", "readme");
    expect(getFrecencyMap(data, "commands").has("readme")).toBe(false);
    expect(getFrecencyMap(data, "files").has("model")).toBe(false);
  });

  it("filters out very low scores", () => {
    const ancient: FrecencyData = {
      test: {
        old: { count: 1, lastUsed: Date.now() - 90 * 24 * 60 * 60 * 1000 },
      },
    };
    const map = getFrecencyMap(ancient, "test");
    expect(map.size).toBe(0);
  });
});
