// One module store shared by header chips, the draft chip, the overlay and the settings
// section. State arrives by RPC; realtime only says "refetch".
import { useSyncExternalStore } from 'react';
import type { PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { DraftView, rpcContract, StateView, ThreadView } from './contracts.ts';

export type Rpc = PluginRpcClient<typeof rpcContract>;
export type Target = { kind: 'thread'; threadId: string; projectId: string } | { kind: 'draft'; projectId: string };
export type Anchor = { top: number; right: number; bottom: number; left: number } | null;
export type Open = { target: Target; anchor: Anchor; instant: boolean } | null;
export type Connectors = { list: string[]; error: string | null } | 'loading';

interface State {
  view: StateView | null;
  threads: ReadonlyMap<string, ThreadView & { projectId: string }>;
  drafts: ReadonlyMap<string, DraftView>;
  connectors: ReadonlyMap<string, Connectors>;
  /** The new-thread composer on screen, for the keyboard command. */
  draftProject: string | null;
  open: Open;
}
let state: State = { view: null, threads: new Map(), drafts: new Map(), connectors: new Map(), draftProject: null, open: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useConnectors = () => useSyncExternalStore(subscribe, () => state);

let client: Rpc | null = null;
export function setClient(rpc: Rpc) { client = rpc; }
export function rpc(): Rpc {
  if (!client) throw new Error('Claude Connectors is still loading.');
  return client;
}
export const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export async function refresh() {
  try { set({ view: await rpc().call('state', null) }); } catch { /* keep the last view */ }
  await Promise.all([
    ...[...state.threads.values()].map(t => loadThread(t.threadId, t.projectId)),
    ...[...state.drafts.keys()].map(loadDraft),
  ]);
}

export async function loadThread(threadId: string, projectId: string) {
  try {
    const view = await rpc().call('thread', { threadId, projectId });
    set({ threads: new Map(state.threads).set(threadId, { ...view, projectId }) });
  } catch { /* keep the last value */ }
}

export async function loadDraft(projectId: string) {
  try { set({ drafts: new Map(state.drafts).set(projectId, await rpc().call('draft', { projectId })) }); }
  catch { /* keep the last value */ }
}
export function setDraftProject(projectId: string | null) { set({ draftProject: projectId }); }

/** Lazily lists a profile's connectors once per session; errors are shown, not thrown. */
export async function loadConnectors(profile: string, force = false) {
  if (!force && state.connectors.has(profile)) return;
  set({ connectors: new Map(state.connectors).set(profile, 'loading') });
  try {
    const result = await rpc().call('connectors', { profile });
    set({ connectors: new Map(state.connectors).set(profile, { list: result.connectors, error: result.error }) });
  } catch (cause) {
    set({ connectors: new Map(state.connectors).set(profile, { list: [], error: message(cause) }) });
  }
}

/** value: a profile, "off", or "inherit". */
export async function choose(target: Target, value: string) {
  if (target.kind === 'thread') {
    await rpc().call('setThread', { threadId: target.threadId, value });
    await loadThread(target.threadId, target.projectId);
  } else {
    await rpc().call('setDraft', { projectId: target.projectId, value });
    await loadDraft(target.projectId);
  }
}

export async function setProjectDefault(projectId: string, value: string) {
  await rpc().call('setProject', { projectId, value });
  await refresh();
}

const chipSelector = '[data-cc-chip]';
export function visibleChip(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(chipSelector)).find(chip => chip.getClientRects().length > 0) ?? null;
}

export function toggle(target: Target | null, via: 'pointer' | 'keyboard', from?: HTMLElement) {
  if (state.open) { close(); return; }
  if (!target) return;
  const box = (from ?? visibleChip())?.getBoundingClientRect();
  set({ open: { target, anchor: box ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left } : null, instant: via === 'keyboard' } });
  void refresh();
}
export function close() { set({ open: null }); }

/** For the keyboard command: the thread view it was invoked from, else the new-thread composer. */
export function targetFor(threadId: string | null): Target | null {
  if (threadId) {
    const known = state.threads.get(threadId);
    return known ? { kind: 'thread', threadId, projectId: known.projectId } : null;
  }
  return state.draftProject ? { kind: 'draft', projectId: state.draftProject } : null;
}

export const sourceLabel = (source: 'thread' | 'project' | 'default') =>
  source === 'thread' ? 'this thread' : source === 'project' ? 'project default' : 'global default';
