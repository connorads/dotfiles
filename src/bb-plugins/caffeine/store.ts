// One module store shared by every header chip, the overlay and the command.
// The view arrives over realtime; the overlay holds the rpc client so the
// command, which runs outside React, can open the popover with fresh state.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import type { CaffeineView } from './src/domain.ts';

export type Rpc = PluginRpcClient<typeof rpcContract>;
export type Anchor = { top: number; right: number; bottom: number; left: number } | null;
/** instant: opened by keyboard, so it appears without an entrance. */
export type Open = { anchor: Anchor; instant: boolean } | null;

interface State { view: CaffeineView | null; open: Open }
let state: State = { view: null, open: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useCaffeine = () => useSyncExternalStore(subscribe, () => state);

let client: Rpc | null = null;
export function setClient(rpc: Rpc) { client = rpc; }
export function rpc(): Rpc {
  if (!client) throw new Error('Caffeine is still loading.');
  return client;
}

export const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/** A failed read keeps the last view; the next signal or refocus corrects it. */
export async function refresh() {
  try { set({ view: await rpc().call('state', {}) }); } catch { /* host unreachable: keep the last view */ }
}
export function receiveView(payload: unknown) { set({ view: payload as CaffeineView }); }

const chipSelector = '[data-caffeine-chip]';
/** The chip the user can see: split panes each mount one. */
export function visibleChip(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(chipSelector)).find(chip => chip.getClientRects().length > 0) ?? null;
}

export function toggle(via: 'pointer' | 'keyboard', from?: HTMLElement) {
  if (state.open) { close(); return; }
  const box = (from ?? visibleChip())?.getBoundingClientRect();
  set({ open: { anchor: box ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left } : null, instant: via === 'keyboard' } });
  void refresh();
}
export function close() { set({ open: null }); }

export function useNow(intervalMs: number, active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}
