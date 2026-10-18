// One module store shared by every header chip, the overlay, the settings
// section and the command. State arrives by RPC; realtime only says "refetch".
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { rpcContract, StateView } from './contracts.ts';

export type Rpc = PluginRpcClient<typeof rpcContract>;
export type Choice = { kind: 'default' } | { kind: 'connection'; id: string } | { kind: 'off' };
export type Anchor = { top: number; right: number; bottom: number; left: number } | null;
/** instant: opened by keyboard, so it appears without an entrance. */
export type Open = { threadId: string | null; anchor: Anchor; instant: boolean } | null;

interface State { view: StateView | null; choices: ReadonlyMap<string, Choice>; open: Open }
let state: State = { view: null, choices: new Map(), open: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useExecutor = () => useSyncExternalStore(subscribe, () => state);

let client: Rpc | null = null;
export function setClient(rpc: Rpc) { client = rpc; }
export function rpc(): Rpc {
  if (!client) throw new Error('Executor is still loading.');
  return client;
}

export const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/** A failed read keeps the last view; the next signal or refocus corrects it. */
export async function refresh() {
  try { set({ view: await rpc().call('state', null) }); } catch { /* server unreachable: keep the last view */ }
}

export async function loadChoice(threadId: string) {
  try {
    const choice = await rpc().call('threadChoice', { threadId });
    set({ choices: new Map(state.choices).set(threadId, choice) });
  } catch { /* keep the last choice */ }
}

export async function choose(threadId: string, choice: Choice) {
  set({ choices: new Map(state.choices).set(threadId, choice) });
  await rpc().call('setThreadChoice', { threadId, choice });
}

export type Resolved =
  | { kind: 'connection'; id: string; name: string; signedIn: boolean; viaDefault: boolean }
  | { kind: 'off' }
  | { kind: 'none' };

/** Mirrors the server's resolveChoice so the chip names what the next call will use. */
export function resolve(view: StateView | null, choice: Choice | undefined): Resolved {
  if (choice?.kind === 'off') return { kind: 'off' };
  const connections = view?.connections ?? [];
  const chosen = choice?.kind === 'connection' ? connections.find(c => c.id === choice.id) : undefined;
  const connection = chosen ?? connections.find(c => c.isDefault);
  if (!connection) return { kind: 'none' };
  return { kind: 'connection', id: connection.id, name: connection.name, signedIn: connection.status === 'signed-in', viaDefault: !chosen };
}

const chipSelector = '[data-executor-chip]';
/** The chip the user can see: split panes each mount one. */
export function visibleChip(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(chipSelector)).find(chip => chip.getClientRects().length > 0) ?? null;
}

export function toggle(threadId: string | null, via: 'pointer' | 'keyboard', from?: HTMLElement) {
  if (state.open) { close(); return; }
  const box = (from ?? visibleChip())?.getBoundingClientRect();
  set({ open: { threadId, anchor: box ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left } : null, instant: via === 'keyboard' } });
  void refresh();
  if (threadId) void loadChoice(threadId);
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

export function countdown(expiresAt: number, now: number): string {
  const secs = Math.max(0, Math.round((expiresAt - now) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}
