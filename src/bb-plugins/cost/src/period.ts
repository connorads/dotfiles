import { useSyncExternalStore } from 'react';

export type Days = 7 | 30 | 90;
export const periods: readonly Days[] = [7, 30, 90];
const key = 'bb-plugin-cost.period';
const listeners = new Set<() => void>();

function read(): Days {
  const saved = Number(globalThis.localStorage?.getItem(key));
  return periods.includes(saved as Days) ? saved as Days : 30;
}
let current = read();

/** The period the page header picks and the page body shows; it persists across visits. */
export function setPeriod(days: Days) {
  current = days;
  globalThis.localStorage?.setItem(key, String(days));
  for (const listener of listeners) listener();
}
export function usePeriod(): Days {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => current);
}
