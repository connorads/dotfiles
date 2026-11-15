/** A row waiting for its second press, and when the first press armed it. */
export interface Armed { row: string; at: number }

/** How long an armed row waits for its second press. */
export const ARMED_MS = 4_000;
/** A second press sooner than this is the same gesture as the first, such as a key tapped twice by reflex. */
export const SECOND_PRESS_MS = 400;

export type Press = { go: true } | { go: false; armed: Armed };

/**
 * The lid confirm: a lid session takes a second, deliberate press of the same row unless BB knows
 * the Mac is on mains. A press too soon after the first keeps the row armed from its first press.
 */
export function press(armed: Armed | null, row: string, now: number, onMains: boolean): Press {
  if (onMains) return { go: true };
  if (armed?.row === row && now - armed.at < ARMED_MS) {
    return now - armed.at >= SECOND_PRESS_MS ? { go: true } : { go: false, armed };
  }
  return { go: false, armed: { row, at: now } };
}
