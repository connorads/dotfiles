// Per-key cache with single flight and stale-while-revalidate. Mention search is
// time-boxed to 2s and fires per keystroke, and a cold `skl list` takes about
// as long, so search reads the catalogue from here. An expired entry answers at
// once and reloads in the background. A failed first load is not cached; a
// failed reload keeps the stale value for another TTL.

/** `fresh` skips a live entry and replaces it: the picker always reads the catalogue anew, like `skl-pick`. */
export type Cache<V> = { get(key: string, load: () => Promise<V>, options?: { fresh?: boolean }): Promise<V> };

type Entry<V> = { at: number; value: Promise<V>; reloading: boolean };

export function createCache<V>(ttlMs: number, now: () => number = Date.now): Cache<V> {
  const entries = new Map<string, Entry<V>>();

  const start = (key: string, load: () => Promise<V>): Promise<V> => {
    const value = load();
    const entry: Entry<V> = { at: now(), value, reloading: false };
    entries.set(key, entry);
    value.catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
    });
    return value;
  };

  const reload = (key: string, stale: Entry<V>, load: () => Promise<V>) => {
    stale.reloading = true;
    const value = load();
    value.then(
      () => { if (entries.get(key) === stale) entries.set(key, { at: now(), value, reloading: false }); },
      () => { stale.reloading = false; stale.at = now(); },
    );
  };

  return {
    get(key, load, { fresh = false } = {}) {
      const hit = entries.get(key);
      if (fresh || !hit) return start(key, load);
      if (now() - hit.at >= ttlMs && !hit.reloading) reload(key, hit, load);
      return hit.value;
    },
  };
}
