// Keyboard model of the picker, kept to fzf's bindings from `skl-pick` so the
// muscle memory carries over: tab marks and moves down, enter acts on the
// marks (or the cursor row when nothing is marked), ctrl-y copies, alt-i
// installs, ctrl-/ toggles the preview, esc closes.

import type { Row } from './rows.ts';

export type Key = {
  readonly key: string;
  /** `KeyboardEvent.code`: Alt+I on macOS reports key "ˆ", so letters match on code. */
  readonly code: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
};

export type PickerState = {
  readonly query: string;
  readonly cursor: number;
  /** Marked refs; folder refs mean the whole group. */
  readonly marked: readonly string[];
  readonly preview: boolean;
};

export type Action = 'load' | 'copy' | 'install';

export type Effect =
  | { readonly kind: 'none' }
  | { readonly kind: 'close' }
  | { readonly kind: Action; readonly refs: readonly string[] };

export type Step = { readonly state: PickerState; readonly effect: Effect; readonly handled: boolean };

export const initialState: PickerState = { query: '', cursor: 0, marked: [], preview: false };

export function setQuery(state: PickerState, query: string): PickerState {
  return query === state.query ? state : { ...state, query, cursor: 0 };
}

export function cursorRow(state: PickerState, visible: readonly Row[]): Row | undefined {
  return visible[Math.min(state.cursor, visible.length - 1)];
}

/** Marked refs in list order, or the cursor row's ref when nothing is marked. */
export function chosenRefs(state: PickerState, visible: readonly Row[], all: readonly Row[]): string[] {
  if (state.marked.length > 0) {
    const marked = new Set(state.marked);
    return all.filter(row => marked.has(row.ref)).map(row => row.ref);
  }
  const row = cursorRow(state, visible);
  return row ? [row.ref] : [];
}

const none: Effect = { kind: 'none' };

export function onKey(state: PickerState, key: Key, visible: readonly Row[], all: readonly Row[]): Step {
  const move = (delta: number): PickerState => {
    if (visible.length === 0) return { ...state, cursor: 0 };
    const cursor = Math.max(0, Math.min(visible.length - 1, state.cursor + delta));
    return { ...state, cursor };
  };
  const toggleThenMove = (delta: number): PickerState => {
    const row = cursorRow(state, visible);
    if (!row) return state;
    const marked = state.marked.includes(row.ref)
      ? state.marked.filter(ref => ref !== row.ref)
      : [...state.marked, row.ref];
    const moved = move(delta);
    return { ...moved, marked };
  };
  const act = (kind: Action): Step => {
    const refs = chosenRefs(state, visible, all);
    return { state, effect: refs.length > 0 ? { kind, refs } : none, handled: true };
  };
  const plain = !key.ctrl && !key.alt && !key.meta;

  if (key.key === 'Escape') return { state, effect: { kind: 'close' }, handled: true };
  if (key.key === 'Enter' && plain && !key.shift) return act('load');
  if (key.ctrl && !key.alt && key.code === 'KeyY') return act('copy');
  if (key.alt && !key.ctrl && key.code === 'KeyI') return act('install');
  if (key.ctrl && (key.key === '/' || key.code === 'Slash')) {
    return { state: { ...state, preview: !state.preview }, effect: none, handled: true };
  }
  if (key.key === 'Tab' && plain) {
    return { state: toggleThenMove(key.shift ? -1 : 1), effect: none, handled: true };
  }
  if (key.key === 'ArrowDown' || (key.ctrl && (key.code === 'KeyN' || key.code === 'KeyJ'))) {
    return { state: move(1), effect: none, handled: true };
  }
  if (key.key === 'ArrowUp' || (key.ctrl && (key.code === 'KeyP' || key.code === 'KeyK'))) {
    return { state: move(-1), effect: none, handled: true };
  }
  return { state, effect: none, handled: false };
}
