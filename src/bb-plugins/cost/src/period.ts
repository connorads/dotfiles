import { useSyncExternalStore } from 'react';

export type Days = 7 | 30 | 90;
export const periods: readonly Days[] = [7, 30, 90];

/**
 * A setting the page header picks and the page body follows, persisted across visits.
 * The header and body are separate React trees, so they share it through this store rather than props.
 */
function persisted<T>(key: string, parse: (raw: string | null) => T) {
  const listeners = new Set<() => void>();
  let current = parse(globalThis.localStorage?.getItem(key) ?? null);
  return {
    set: (value: T) => {
      current = value;
      globalThis.localStorage?.setItem(key, JSON.stringify(value));
      for (const listener of listeners) listener();
    },
    use: () => useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => current),
  };
}

const period = persisted<Days>('bb-plugin-cost.period', raw => periods.includes(Number(raw) as Days) ? Number(raw) as Days : 30);
const grouping = persisted<boolean>('bb-plugin-cost.group', raw => raw === 'true');

export const usePeriod = period.use;
export const setPeriod = period.set;
/** True: each sub-thread's usage counts toward the thread that started it. */
export const useGrouped = grouping.use;
export const setGrouped = grouping.set;
