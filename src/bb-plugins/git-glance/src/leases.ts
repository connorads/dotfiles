// Which repositories some open window still shows. BB tells the server nothing about
// windows, so each one renews a lease per thread; an unrenewed lease expires.

export interface Checkout { hostId: string; root: string }
export const checkoutKey = (checkout: Checkout) => `${checkout.hostId}\0${checkout.root}`;

interface Entry { checkout: Checkout; holders: Map<string, { threadId: string; expiresAt: number }> }

export function createLeases(ttlMs: number) {
  const entries = new Map<string, Entry>();
  return {
    /** Returns true when this is the checkout's first holder, so the caller starts watching. */
    touch(checkout: Checkout, holder: string, threadId: string, now: number): boolean {
      const key = checkoutKey(checkout);
      const entry = entries.get(key) ?? { checkout, holders: new Map() };
      const first = entry.holders.size === 0;
      entry.holders.set(holder, { threadId, expiresAt: now + ttlMs });
      entries.set(key, entry);
      return first;
    },
    /** Returns the checkout when its last holder left, so the caller stops watching. */
    release(checkout: Checkout, holder: string): Checkout | null {
      const key = checkoutKey(checkout);
      const entry = entries.get(key);
      if (!entry?.holders.delete(holder) || entry.holders.size > 0) return null;
      entries.delete(key);
      return entry.checkout;
    },
    /** Move every window showing a thread to its selected repository. */
    move(threadId: string, target: Checkout): Checkout[] {
      const emptied: Checkout[] = [];
      for (const [key, entry] of entries) {
        if (key === checkoutKey(target)) continue;
        for (const [holder, lease] of entry.holders) {
          if (lease.threadId !== threadId) continue;
          entry.holders.delete(holder);
          this.touch(target, holder, threadId, lease.expiresAt - ttlMs);
        }
        if (entry.holders.size === 0) { entries.delete(key); emptied.push(entry.checkout); }
      }
      return emptied;
    },
    /** Drops expired holders and returns checkouts nobody holds any more. */
    sweep(now: number): Checkout[] {
      const emptied: Checkout[] = [];
      for (const [key, entry] of entries) {
        for (const [holder, lease] of entry.holders) if (lease.expiresAt <= now) entry.holders.delete(holder);
        if (entry.holders.size === 0) { entries.delete(key); emptied.push(entry.checkout); }
      }
      return emptied;
    },
    threads(checkout: Checkout): string[] {
      return [...new Set([...entries.get(checkoutKey(checkout))?.holders.values() ?? []].map(lease => lease.threadId))];
    },
    checkouts(hostId: string): Checkout[] {
      return [...entries.values()].map(entry => entry.checkout).filter(checkout => checkout.hostId === hostId);
    },
  };
}
