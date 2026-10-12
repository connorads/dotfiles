// Single-flight TTL cache: every chip in every window and split pane asks the
// server, and each machine is sampled at most once per TTL. A rejected load is
// evicted so the next caller retries instead of replaying the failure.

export function createTtlCache<K, V>(ttlMs: number, now: () => number) {
  const entries = new Map<K, { at: number; value: Promise<V> }>();
  return {
    get(key: K, load: () => Promise<V>): Promise<V> {
      const hit = entries.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.value;
      const value = load();
      const entry = { at: now(), value };
      entries.set(key, entry);
      value.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
      return value;
    },
    /** Drop a reading an action has just made stale. */
    delete(key: K): void {
      entries.delete(key);
    },
  };
}
