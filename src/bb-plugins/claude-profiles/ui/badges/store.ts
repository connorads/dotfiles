import type { ThreadAccount } from '../../contracts.ts';

// Content scripts have no RPC access, so a React bridge writes thread accounts here for the row script.
let badges = new Map<string, ThreadAccount>();
const listeners = new Set<() => void>();
export function setBadges(accounts: readonly ThreadAccount[]) {
  badges = new Map(accounts.map(account => [account.threadId, account]));
  for (const listener of listeners) listener();
}
export const getBadges = () => badges;
export function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
