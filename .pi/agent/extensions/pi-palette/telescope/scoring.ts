/**
 * fzf-style Fuzzy Scoring Engine
 *
 * Supports:
 *   - Subsequence matching with smart scoring
 *   - Pattern modifiers: 'exact, ^prefix, suffix$, !negate
 *   - Multiple tokens (space-separated, AND logic)
 *   - Frecency boost integration
 *
 * Scoring bonuses:
 *   - Consecutive character: +15
 *   - Word boundary (/, \, _, -, ., space): +15
 *   - Filename start (after last /): +50
 *   - Path start: +20
 *   - camelCase boundary: +5
 *   - Gap penalty: -min(distance, 15)
 */

import type { ScoredItem } from "./types.js";

// ── Character classification ────────────────────────

function isWordBoundary(text: string, idx: number): boolean {
  if (idx === 0) return true;
  const prev = text.charCodeAt(idx - 1);
  return (
    prev === 47 || // /
    prev === 92 || // \
    prev === 95 || // _
    prev === 45 || // -
    prev === 46 || // .
    prev === 32 //    space
  );
}

function isUpperCase(code: number): boolean {
  return code >= 65 && code <= 90;
}

// ── Core matching ───────────────────────────────────

/**
 * Beam-search best fuzzy match for a query against text.
 * For each query character, explores all possible positions
 * in text, keeping the top N candidates.
 */
function computeBestMatch(
  lowerQuery: string,
  text: string,
): { score: number; indices: number[] } {
  const queryLen = lowerQuery.length;
  const textLen = text.length;

  if (queryLen === 0) return { score: 0, indices: [] };
  if (queryLen > textLen) return { score: -Infinity, indices: [] };

  const lowerText = text.toLowerCase();
  const filenameStart = text.lastIndexOf("/") + 1;

  interface State {
    score: number;
    lastIdx: number;
    indices: number[];
  }

  let beam: State[] = [{ score: 0, lastIdx: -1, indices: [] }];

  for (let qi = 0; qi < queryLen; qi++) {
    const char = lowerQuery[qi]!;
    const nextBeam: State[] = [];

    for (const state of beam) {
      let searchFrom = state.lastIdx + 1;

      while (searchFrom < textLen) {
        const foundIdx = lowerText.indexOf(char, searchFrom);
        if (foundIdx === -1) break;

        const distance = foundIdx - state.lastIdx;
        let localScore = 0;

        if (qi > 0) {
          if (distance === 1) {
            localScore += 15; // consecutive
          } else {
            localScore -= Math.min(distance, 15); // gap penalty
          }
        }

        if (foundIdx === 0) localScore += 20; // path start
        if (foundIdx === filenameStart) localScore += 50; // filename start
        if (isWordBoundary(text, foundIdx)) localScore += 15; // word boundary
        if (isUpperCase(text.charCodeAt(foundIdx))) localScore += 5; // camelCase

        nextBeam.push({
          score: state.score + localScore,
          lastIdx: foundIdx,
          indices: [...state.indices, foundIdx],
        });

        searchFrom = foundIdx + 1;
      }
    }

    if (nextBeam.length === 0) return { score: -Infinity, indices: [] };

    // Deduplicate: keep best score per lastIdx
    const bestByIdx = new Map<number, State>();
    for (const s of nextBeam) {
      const existing = bestByIdx.get(s.lastIdx);
      if (!existing || s.score > existing.score) {
        bestByIdx.set(s.lastIdx, s);
      }
    }

    const candidates = Array.from(bestByIdx.values());
    candidates.sort((a, b) => b.score - a.score);
    beam = candidates.slice(0, 30); // beam width
  }

  return beam[0] ?? { score: -Infinity, indices: [] };
}

// ── Subsequence check ───────────────────────────────

/** Check if query is a subsequence of text (case-insensitive). */
export function isSubsequence(query: string, text: string): boolean {
  if (query.length > text.length) return false;
  const lq = query.toLowerCase();
  const lt = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lt.length && qi < lq.length; i++) {
    if (lt[i] === lq[qi]) qi++;
  }
  return qi === lq.length;
}

/** Score and match a query against text. */
export function computeMatch(
  query: string,
  text: string,
): { score: number; indices: number[] } {
  if (!query) return { score: 0, indices: [] };
  if (!text) return { score: -Infinity, indices: [] };
  return computeBestMatch(query.toLowerCase(), text);
}

// ── Pattern modifiers ───────────────────────────────

export interface ParsedToken {
  readonly type: "fuzzy" | "exact" | "prefix" | "suffix" | "negate";
  readonly text: string;
}

/**
 * Parse a query string into tokens with pattern modifiers.
 *
 * Syntax (fzf-inspired):
 *   'term  -> exact substring match
 *   ^term  -> prefix match
 *   term$  -> suffix match
 *   !term  -> negate (exclude matches)
 *   term   -> fuzzy match (default)
 *
 * Tokens are space-separated and AND-ed together.
 */
export function parseQueryTokens(query: string): ParsedToken[] {
  if (!query) return [];
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((token): ParsedToken => {
      if (token.startsWith("'") && token.length > 1)
        return { type: "exact", text: token.slice(1) };
      if (token.startsWith("^") && token.length > 1)
        return { type: "prefix", text: token.slice(1) };
      if (token.startsWith("!") && token.length > 1)
        return { type: "negate", text: token.slice(1) };
      if (token.endsWith("$") && token.length > 1)
        return { type: "suffix", text: token.slice(0, -1) };
      return { type: "fuzzy", text: token };
    });
}

/** Check if an item passes all modifier (non-fuzzy) tokens. */
function passesModifiers(lowerText: string, modifiers: ParsedToken[]): boolean {
  for (const token of modifiers) {
    const lt = token.text.toLowerCase();
    switch (token.type) {
      case "exact":
        if (!lowerText.includes(lt)) return false;
        break;
      case "prefix":
        if (!lowerText.startsWith(lt) && !lowerText.includes("/" + lt))
          return false;
        break;
      case "suffix":
        if (!lowerText.endsWith(lt)) return false;
        break;
      case "negate":
        if (lowerText.includes(lt)) return false;
        break;
    }
  }
  return true;
}

// ── Main filter/score API ───────────────────────────

const FRECENCY_WEIGHT = 5;

/**
 * Filter and score a list of items against a query.
 * Returns items sorted by score (best first), with match indices.
 */
export function filterAndScore<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  limit = 5000,
  frecencyMap?: Map<string, number>,
  getFrecencyKey?: (item: T) => string,
): ScoredItem<T>[] {
  if (!query) {
    const result = items.slice(0, limit).map((item) => {
      const fKey = getFrecencyKey ? getFrecencyKey(item) : getText(item);
      const fBoost = frecencyMap?.get(fKey) ?? 0;
      return {
        item,
        score: fBoost * FRECENCY_WEIGHT,
        indices: [] as number[],
      };
    });
    if (frecencyMap && frecencyMap.size > 0) {
      result.sort((a, b) => b.score - a.score);
    }
    return result;
  }

  const tokens = parseQueryTokens(query);
  const fuzzyTokens = tokens.filter((t) => t.type === "fuzzy");
  const modifierTokens = tokens.filter((t) => t.type !== "fuzzy");
  const fuzzyPart = fuzzyTokens.map((t) => t.text).join("");
  const lowerFuzzy = fuzzyPart.toLowerCase();

  const results: ScoredItem<T>[] = [];

  for (const item of items) {
    const text = getText(item);
    const lowerText = text.toLowerCase();

    if (!passesModifiers(lowerText, modifierTokens)) continue;

    if (fuzzyPart) {
      if (!isSubsequence(fuzzyPart, text)) continue;
      const { score, indices } = computeBestMatch(lowerFuzzy, text);
      if (score > -Infinity) {
        const fKey = getFrecencyKey ? getFrecencyKey(item) : text;
        const fBoost = frecencyMap?.get(fKey) ?? 0;
        results.push({ item, score: score + fBoost * FRECENCY_WEIGHT, indices });
      }
    } else {
      const fKey = getFrecencyKey ? getFrecencyKey(item) : text;
      const fBoost = frecencyMap?.get(fKey) ?? 0;
      results.push({ item, score: fBoost * FRECENCY_WEIGHT, indices: [] });
    }

    if (results.length >= limit) break;
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
