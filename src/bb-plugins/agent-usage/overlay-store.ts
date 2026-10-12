import { useSyncExternalStore } from 'react';

let open = false;
let returnFocus: HTMLElement | null = null;
let returnThreadId: string | null = null;
const listeners = new Set<() => void>();

export function openUsage(): void {
  if (open) return;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  returnThreadId = returnFocus?.getAttribute('data-au-thread') ?? null;
  open = true;
  for (const listener of listeners) listener();
}

export function closeUsage(): void {
  if (!open) return;
  open = false;
  for (const listener of listeners) listener();
}

export function restoreUsageFocus(): void {
  if (open) return;
  if (returnFocus?.isConnected) returnFocus.focus();
  else if (returnThreadId !== null) {
    const badge = Array.from(document.querySelectorAll<HTMLElement>('[data-au-thread]'))
      .find(element => element.getAttribute('data-au-thread') === returnThreadId);
    badge?.focus();
  }
  returnFocus = null;
  returnThreadId = null;
}

export function useUsageOpen(): boolean {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => open, () => false);
}
