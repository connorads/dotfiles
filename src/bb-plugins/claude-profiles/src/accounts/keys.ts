// Each account keeps one letter for picker shortcuts and sidebar badges, so muscle memory survives new accounts.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export type AccountKeys = Record<string, string>;

export function assignKeys(saved: Readonly<AccountKeys>, profiles: readonly { id: string; label: string }[]): { keys: AccountKeys; changed: boolean } {
  const keys: AccountKeys = {};
  const used = new Set<string>();
  for (const [id, letter] of Object.entries(saved)) {
    if (/^[A-Z]$/.test(letter) && !used.has(letter)) { keys[id] = letter; used.add(letter); }
  }
  let changed = Object.keys(keys).length !== Object.keys(saved).length;
  for (const profile of profiles) {
    if (keys[profile.id]) continue;
    const letter = profile.label.toUpperCase().split('').concat(LETTERS.split('')).find(char => LETTERS.includes(char) && !used.has(char));
    if (!letter) continue;
    keys[profile.id] = letter;
    used.add(letter);
    changed = true;
  }
  return { keys, changed };
}
