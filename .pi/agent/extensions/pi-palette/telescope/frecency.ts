/**
 * Frecency Tracking
 *
 * Tracks frequency + recency of telescope selections.
 * Score formula: count * 0.5^(age / halfLife)
 *   - half-life of 7 days: scores halve weekly
 *
 * Pure functions exported for testing; IO wrapper for persistence.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const FRECENCY_PATH = join(
  process.env.HOME ?? "~",
  ".pi/telescope-frecency.json",
);
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENTRIES_PER_PROVIDER = 500;

// ── Types ───────────────────────────────────────────

export interface FrecencyEntry {
  count: number;
  lastUsed: number;
}

export interface FrecencyData {
  [provider: string]: Record<string, FrecencyEntry>;
}

// ── Pure functions ──────────────────────────────────

export function computeFrecencyScore(entry: FrecencyEntry): number {
  const age = Date.now() - entry.lastUsed;
  const recency = Math.pow(0.5, age / HALF_LIFE_MS);
  return entry.count * recency;
}

export function pruneEntries(
  entries: Record<string, FrecencyEntry>,
  limit: number,
): Record<string, FrecencyEntry> {
  const sorted = Object.entries(entries).sort(
    (a, b) => computeFrecencyScore(b[1]) - computeFrecencyScore(a[1]),
  );
  return Object.fromEntries(sorted.slice(0, limit));
}

/** Record a selection, returning updated data (pure). */
export function recordSelection(
  data: FrecencyData,
  provider: string,
  key: string,
): FrecencyData {
  const providerData = { ...(data[provider] ?? {}) };
  const entry = providerData[key] ?? { count: 0, lastUsed: 0 };
  providerData[key] = { count: entry.count + 1, lastUsed: Date.now() };

  const pruned =
    Object.keys(providerData).length > MAX_ENTRIES_PER_PROVIDER
      ? pruneEntries(providerData, MAX_ENTRIES_PER_PROVIDER)
      : providerData;

  return { ...data, [provider]: pruned };
}

/** Get frecency scores as a Map, filtering out near-zero entries. */
export function getFrecencyMap(
  data: FrecencyData,
  provider: string,
): Map<string, number> {
  const providerData = data[provider];
  if (!providerData) return new Map();

  const map = new Map<string, number>();
  for (const [key, entry] of Object.entries(providerData)) {
    const score = computeFrecencyScore(entry);
    if (score > 0.01) map.set(key, score);
  }
  return map;
}

// ── IO wrapper (imperative shell) ───────────────────

let cache: FrecencyData | null = null;

function load(): FrecencyData {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(FRECENCY_PATH, "utf-8"));
    return cache!;
  } catch {
    cache = {};
    return cache;
  }
}

function save(): void {
  if (!cache) return;
  try {
    mkdirSync(dirname(FRECENCY_PATH), { recursive: true });
    writeFileSync(FRECENCY_PATH, JSON.stringify(cache));
  } catch {
    // Frecency is best-effort
  }
}

/** Record a selection and persist (side-effecting). */
export function recordAndPersist(provider: string, key: string): void {
  cache = recordSelection(load(), provider, key);
  save();
}

/** Load frecency map for a provider from disk. */
export function loadFrecencyMap(provider: string): Map<string, number> {
  return getFrecencyMap(load(), provider);
}
