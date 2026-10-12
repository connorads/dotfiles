import { EXTEND_OPTIONS, START_OPTIONS } from './format.ts';

/** Which popover screen has the keyboard. `stuck`: the SleepDisabled flag is set with no lid session. */
export type Screen =
  | { kind: 'off'; stuck: boolean }
  | { kind: 'lid-picker' }
  | { kind: 'on'; timed: boolean; stuck: boolean }
  | { kind: 'lid' }
  | { kind: 'agents'; stuck: boolean }
  | { kind: 'unsupported' };

export type Action =
  /** secs 0 is indefinite. */
  | { kind: 'start'; secs: number }
  | { kind: 'startLid'; secs: number }
  | { kind: 'extend'; add: number }
  | { kind: 'agents' }
  | { kind: 'off' }
  | { kind: 'clear' }
  | { kind: 'lidPicker' }
  | { kind: 'focus'; row: string }
  | { kind: 'back' }
  | { kind: 'close' };

/** The `data-row` value of the row an action belongs to, so a key and a click land on one element. */
export function rowId(action: Action): string {
  switch (action.kind) {
    case 'start': return `start:${action.secs}`;
    case 'startLid': return `lid:${action.secs}`;
    case 'extend': return `extend:${action.add}`;
    case 'focus': return action.row;
    default: return action.kind;
  }
}

const digit = (key: string, options: readonly number[]) => {
  const index = /^[1-9]$/.test(key) ? Number(key) - 1 : -1;
  return options[index] ?? null;
};

/** One key on one screen. Arrows and Enter are the popover's; everything else is here. */
export function keyAction(screen: Screen, key: string): Action | null {
  if (key === 'q') return { kind: 'close' };
  if (key === 'Escape') return screen.kind === 'lid-picker' ? { kind: 'back' } : { kind: 'close' };
  switch (screen.kind) {
    case 'unsupported':
      return null;
    case 'off': {
      if (key === 'i') return { kind: 'start', secs: 0 };
      if (key === 't') return { kind: 'focus', row: rowId({ kind: 'start', secs: START_OPTIONS[0] }) };
      if (key === 'a') return { kind: 'agents' };
      if (key === 'l') return { kind: 'lidPicker' };
      if (key === 'c') return screen.stuck ? { kind: 'clear' } : null;
      const secs = digit(key, START_OPTIONS);
      return secs === null ? null : { kind: 'start', secs };
    }
    case 'lid-picker': {
      const secs = digit(key, START_OPTIONS);
      return secs === null ? null : { kind: 'startLid', secs };
    }
    case 'on':
    case 'lid': {
      if (key === 'o') return { kind: 'off' };
      if (key === 'c') return screen.kind === 'on' && screen.stuck ? { kind: 'clear' } : null;
      const timed = screen.kind === 'lid' || screen.timed;
      if (!timed) return null;
      if (key === '+' || key === '=') return { kind: 'focus', row: rowId({ kind: 'extend', add: EXTEND_OPTIONS[0] }) };
      const add = digit(key, EXTEND_OPTIONS);
      return add === null ? null : { kind: 'extend', add };
    }
    case 'agents':
      if (key === 'o') return { kind: 'off' };
      return key === 'c' && screen.stuck ? { kind: 'clear' } : null;
  }
}
