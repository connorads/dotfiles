/**
 * Telescope State Machine (Pure)
 *
 * Pure reducer for telescope UI state. No side effects.
 * The overlay component dispatches actions and renders from state.
 */

import type { ScoredItem } from "./types.js";

// ── State ───────────────────────────────────────────

export type Mode = "search" | "provider-picker" | "help" | "action-picker";

export interface TelescopeState<T = unknown> {
  readonly query: string;
  readonly cursorPos: number;
  readonly filtered: readonly ScoredItem<T>[];
  readonly selectedIndex: number;
  readonly scrollOffset: number;
  readonly showPreview: boolean;
  readonly mode: Mode;
  readonly selectedKeys: ReadonlySet<string>;
  // Terminal results (set by select/cancel actions)
  readonly selectedItem?: T;
  readonly cancelled?: boolean;
}

// ── Actions ─────────────────────────────────────────

export type TelescopeAction<T = unknown> =
  | { readonly type: "type"; readonly char: string }
  | { readonly type: "backspace" }
  | { readonly type: "deleteWord" }
  | { readonly type: "moveUp" }
  | { readonly type: "moveDown" }
  | { readonly type: "pageUp" }
  | { readonly type: "pageDown" }
  | { readonly type: "select" }
  | { readonly type: "cancel" }
  | { readonly type: "toggleSelect" }
  | { readonly type: "togglePreview" }
  | { readonly type: "setFiltered"; readonly filtered: readonly ScoredItem<T>[] };

// ── Reducer ─────────────────────────────────────────

export function initialState<T>(
  filtered: readonly ScoredItem<T>[],
  initialQuery = "",
): TelescopeState<T> {
  return {
    query: initialQuery,
    cursorPos: initialQuery.length,
    filtered,
    selectedIndex: 0,
    scrollOffset: 0,
    showPreview: true,
    mode: "search",
    selectedKeys: new Set(),
  };
}

export function reduce<T>(
  state: TelescopeState<T>,
  action: TelescopeAction<T>,
): TelescopeState<T> {
  switch (action.type) {
    case "type": {
      const query =
        state.query.slice(0, state.cursorPos) +
        action.char +
        state.query.slice(state.cursorPos);
      return {
        ...state,
        query,
        cursorPos: state.cursorPos + 1,
        selectedIndex: 0,
        scrollOffset: 0,
      };
    }

    case "backspace": {
      if (state.cursorPos === 0) return state;
      const query =
        state.query.slice(0, state.cursorPos - 1) +
        state.query.slice(state.cursorPos);
      return {
        ...state,
        query,
        cursorPos: state.cursorPos - 1,
        selectedIndex: 0,
        scrollOffset: 0,
      };
    }

    case "deleteWord": {
      const before = state.query.slice(0, state.cursorPos);
      const after = state.query.slice(state.cursorPos);
      const trimmed = before.replace(/\S+\s*$/, "");
      return {
        ...state,
        query: trimmed + after,
        cursorPos: trimmed.length,
        selectedIndex: 0,
        scrollOffset: 0,
      };
    }

    case "moveUp":
      return {
        ...state,
        selectedIndex: Math.max(0, state.selectedIndex - 1),
      };

    case "moveDown":
      return {
        ...state,
        selectedIndex: Math.min(
          state.filtered.length - 1,
          state.selectedIndex + 1,
        ),
      };

    case "pageUp":
      return {
        ...state,
        selectedIndex: Math.max(0, state.selectedIndex - 10),
      };

    case "pageDown":
      return {
        ...state,
        selectedIndex: Math.min(
          state.filtered.length - 1,
          state.selectedIndex + 10,
        ),
      };

    case "select": {
      const scored = state.filtered[state.selectedIndex];
      return { ...state, selectedItem: scored?.item };
    }

    case "cancel":
      return { ...state, cancelled: true };

    case "toggleSelect": {
      const scored = state.filtered[state.selectedIndex];
      if (!scored) return state;
      const key = scored.item as unknown as string; // caller provides getText
      const newKeys = new Set(state.selectedKeys);
      if (newKeys.has(key)) {
        newKeys.delete(key);
      } else {
        newKeys.add(key);
      }
      return {
        ...state,
        selectedKeys: newKeys,
        selectedIndex: Math.min(
          state.filtered.length - 1,
          state.selectedIndex + 1,
        ),
      };
    }

    case "togglePreview":
      return { ...state, showPreview: !state.showPreview };

    case "setFiltered":
      return {
        ...state,
        filtered: action.filtered,
        selectedIndex: 0,
        scrollOffset: 0,
      };
  }
}
