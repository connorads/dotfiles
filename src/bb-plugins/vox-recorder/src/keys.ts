// The library dialog's keyboard: which key does what, given where focus is.
// Pure, so the rules are tested without a DOM; library.tsx only carries them out.

/** Where the key landed: the filter input, the recordings list, or anything else (a button). */
export type Focus = 'filter' | 'list' | 'other';

export type LetterAction = 'copy' | 'open' | 'rename' | 'reveal' | 'retranscribe' | 'delete' | 'reclaim' | 'filter';

export type LibraryKey =
  /** Step 0 enters the list on the row already shown as selected. */
  | { kind: 'move'; step: 1 | 0 | -1 }
  | { kind: 'close' }
  | { kind: 'insert' }
  | { kind: 'confirm' }
  | { kind: 'dismiss-confirm' }
  | { kind: 'letter'; action: LetterAction };

export interface KeyInput {
  key: string;
  focus: Focus;
  /** Cmd, Ctrl or Alt held: those belong to bb and the OS. */
  modified: boolean;
  /** The inline rename field owns every key while it is open. */
  renaming: boolean;
  /** A y/n question is showing; it names its own target, so `y` always has one. */
  confirming: boolean;
  /** A row is selected. */
  hasCurrent: boolean;
}

const letters: Readonly<Record<string, LetterAction>> = {
  c: 'copy', e: 'open', r: 'rename', o: 'reveal', t: 'retranscribe', d: 'delete', x: 'reclaim', '/': 'filter',
};

/**
 * Null leaves the key to the browser: typing in the filter, and Enter or
 * Space on a focused button, which must click it rather than insert a pill.
 * y and n answer a question from the filter too, because a filter that hides
 * every row leaves focus there.
 */
export function libraryKey(input: KeyInput): LibraryKey | null {
  const { key, focus } = input;
  if (input.modified || input.renaming) return null;
  if ((key === 'q' || key === 'Q') && focus !== 'filter') return { kind: input.confirming ? 'dismiss-confirm' : 'close' };
  if (input.confirming && key === 'y') return { kind: 'confirm' };
  if (input.confirming && key === 'n') return { kind: 'dismiss-confirm' };
  if (focus === 'other') return null;
  if (key === 'ArrowDown' && focus === 'filter') return { kind: 'move', step: 0 };
  if (key === 'ArrowDown' || (focus === 'list' && key === 'j')) return { kind: 'move', step: 1 };
  if (key === 'ArrowUp' || (focus === 'list' && key === 'k')) return { kind: 'move', step: -1 };
  if (key === 'Enter' && input.hasCurrent && !input.confirming) return { kind: 'insert' };
  const action = focus === 'list' && input.hasCurrent ? letters[key] : undefined;
  return action ? { kind: 'letter', action } : null;
}
