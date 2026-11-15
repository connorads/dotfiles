// One module store shared by every header chip, the overlay and the command.
// The view arrives over realtime; the overlay holds the rpc client so the
// command, which runs outside React, can open the popover with fresh state.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import type { ActionResult, CaffeineView } from './src/domain.ts';

export type Rpc = PluginRpcClient<typeof rpcContract>;
export type Anchor = { top: number; right: number; bottom: number; left: number } | null;
/**
 * id: one per opening, so an action closes only the popover it came from. instant: opened by keyboard, so it appears without an entrance.
 * fromChip: the chip opened it, so focus goes back to the chip on close; otherwise to wherever it was, such as the composer.
 */
export type Open = { id: number; anchor: Anchor; instant: boolean; fromChip: boolean } | null;
/** doing: the status line while it runs ("Extending"). failed: names it in a failure read later ("Extend"). */
export interface ActionLabel { doing: string; failed: string }
/** missed: it failed while no popover was open, so the reader needs to know what failed and when. */
export interface ActionError { reason: string; label: ActionLabel; at: number; missed: boolean }

/**
 * readError: why the last state read failed, shown while there is no view to show instead.
 * pending and actionError live here, not in a popover, because an action outlives the popover that started it.
 */
interface State { view: CaffeineView | null; open: Open; readError: string | null; pending: ActionLabel | null; actionError: ActionError | null }
let state: State = { view: null, open: null, readError: null, pending: null, actionError: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const snapshot = () => state;
export const useCaffeine = () => useSyncExternalStore(subscribe, snapshot);

let client: Rpc | null = null;
export function setClient(rpc: Rpc) { client = rpc; }
export function rpc(): Rpc {
  if (!client) throw new Error('Caffeine is still loading.');
  return client;
}

export const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/** A failed read keeps the last view; the next signal, refocus or open corrects it. */
export async function refresh() {
  if (state.readError) set({ readError: null });
  try { set({ view: await rpc().call('state', {}), readError: null }); } catch (cause) { set({ readError: message(cause) }); }
}
export function receiveView(payload: unknown) { set({ view: payload as CaffeineView }); }

const chipSelector = '[data-caffeine-chip]';
/** The chip the user can see: split panes each mount one. */
export function visibleChip(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(chipSelector)).find(chip => chip.getClientRects().length > 0) ?? null;
}

let opened = 0;
export function toggle(via: 'pointer' | 'keyboard', from?: HTMLElement) {
  if (state.open) { close(); return; }
  const box = (from ?? visibleChip())?.getBoundingClientRect();
  opened += 1;
  set({ open: { id: opened, anchor: box ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left } : null, instant: via === 'keyboard', fromChip: from !== undefined } });
  void refresh();
}
/** An action error has been on screen once it reaches a close, so it goes with the popover. */
export function close() { set({ open: null, actionError: null }); }
export function dismissError() { if (state.actionError) set({ actionError: null }); }

/**
 * Runs one host action at a time, across every popover. Success closes the popover it came from
 * when closeOnSuccess, and leaves a popover opened since alone. A failure shows in the open popover,
 * or in the next one to open. Resolves true on success.
 */
export async function act(label: ActionLabel, call: () => Promise<ActionResult>, closeOnSuccess = true): Promise<boolean> {
  if (state.pending) return false;
  const from = state.open?.id;
  set({ pending: label, actionError: null });
  const fail = (reason: string) => set({ actionError: { reason, label, at: Date.now(), missed: state.open === null } });
  try {
    const result = await call();
    if (!result.ok) fail(result.reason);
    else if (closeOnSuccess && from !== undefined && state.open?.id === from) close();
    return result.ok;
  } catch (cause) {
    fail(message(cause));
    return false;
  } finally {
    set({ pending: null });
  }
}

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
