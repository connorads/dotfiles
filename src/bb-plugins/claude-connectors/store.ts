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
/** A popover save: `row` names what is saving; `error` is set once it fails. */
export type Save = { row: string; error: string | null };

interface State {
  view: StateView | null;
  threads: ReadonlyMap<string, ThreadView & { projectId: string }>;
  drafts: ReadonlyMap<string, DraftView>;
  connectors: ReadonlyMap<string, Connectors>;
  /** Why the last `state` load failed, until one succeeds. */
  stateError: string | null;
  /** Thread and draft choices whose last load failed, keyed by `loadKey`, until one loads. */
  loadErrors: ReadonlyMap<string, { target: Target; error: string }>;
  /** Popover saves per `loadKey`, in flight or failed. They outlive the popover, so a reopened
   *  popover still waits for a save, and a failure after Escape still shows on the chip. */
  saves: ReadonlyMap<string, Save>;
  /** The new-thread composer on screen, for the keyboard command. */
  draftProject: string | null;
  open: Open;
}
let state: State = {
  view: null, threads: new Map(), drafts: new Map(), connectors: new Map(), stateError: null, loadErrors: new Map(), saves: new Map(), draftProject: null, open: null,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const snapshot = () => state;
export const useConnectors = () => useSyncExternalStore(subscribe, snapshot);

let client: Rpc | null = null;
export function setClient(rpc: Rpc) { client = rpc; }
export function rpc(): Rpc {
  if (!client) throw new Error('Claude Connectors is still loading.');
  return client;
}
export const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export async function refresh() {
  // A failed reload keeps the last view; screens show the error only while there is no view.
  try { set({ view: await rpc().call('state', null), stateError: null }); } catch (cause) { set({ stateError: message(cause) }); }
  const targets = new Map<string, Target>([
    ...[...state.loadErrors].map(([key, failed]) => [key, failed.target] as const),
    ...[...state.threads.values()].map(t => { const target: Target = { kind: 'thread', threadId: t.threadId, projectId: t.projectId }; return [loadKey(target), target] as const; }),
    ...[...state.drafts.keys()].map(projectId => { const target: Target = { kind: 'draft', projectId }; return [loadKey(target), target] as const; }),
  ]);
  // A failed connector list is fetched again, so signing in to the profile and coming back clears it.
  const failed = [...state.connectors].filter(([, c]) => c !== 'loading' && c.error !== null).map(([profile]) => profile);
  await Promise.all([
    ...[...targets.values()].map(t => t.kind === 'thread' ? loadThread(t.threadId, t.projectId) : loadDraft(t.projectId)),
    ...failed.map(profile => loadConnectors(profile)),
  ]);
}

/** One key per thread or new-thread draft. */
const threadKey = (threadId: string) => `thread:${threadId}`;
export const loadKey = (target: Target) => target.kind === 'thread' ? threadKey(target.threadId) : `draft:${target.projectId}`;
function loadResult(target: Target, error: string | null): Partial<State> {
  const key = loadKey(target);
  if (error === null && !state.loadErrors.has(key)) return {};
  const loadErrors = new Map(state.loadErrors);
  if (error === null) loadErrors.delete(key); else loadErrors.set(key, { target, error });
  return { loadErrors };
}

/** Errors are kept in `loadErrors`, not thrown; the last loaded value stays. */
export async function loadThread(threadId: string, projectId: string) {
  const target: Target = { kind: 'thread', threadId, projectId };
  try {
    const view = await rpc().call('thread', { threadId, projectId });
    set({ threads: new Map(state.threads).set(threadId, { ...view, projectId }), ...loadResult(target, null) });
  } catch (cause) { set(loadResult(target, message(cause))); }
}

export async function loadDraft(projectId: string) {
  const target: Target = { kind: 'draft', projectId };
  try { set({ drafts: new Map(state.drafts).set(projectId, await rpc().call('draft', { projectId })), ...loadResult(target, null) }); }
  catch (cause) { set(loadResult(target, message(cause))); }
}
export function setDraftProject(projectId: string | null) { set({ draftProject: projectId }); }

/** Lists a profile's connectors once per session, and again after a failure; errors are shown, not thrown. */
export async function loadConnectors(profile: string) {
  const cached = state.connectors.get(profile);
  if (cached === 'loading' || (cached && cached.error === null)) return;
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

/** Runs one popover save per target; false when another is in flight or this one fails. */
export async function save(target: Target, row: string, task: () => Promise<unknown>): Promise<boolean> {
  const key = loadKey(target);
  if (state.saves.get(key)?.error === null) return false;
  const put = (value: Save | null) => {
    const saves = new Map(state.saves);
    if (value) saves.set(key, value); else saves.delete(key);
    set({ saves });
  };
  put({ row, error: null });
  try { await task(); put(null); return true; }
  catch (cause) { put({ row, error: message(cause) }); return false; }
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
/** Closing a popover that showed a failed save dismisses that failure. */
export function close() {
  const key = state.open ? loadKey(state.open.target) : null;
  if (key === null || !state.saves.get(key)?.error) { set({ open: null }); return; }
  const saves = new Map(state.saves);
  saves.delete(key);
  set({ open: null, saves });
}

/** For the keyboard command: the thread view it was invoked from, else the new-thread composer. */
export function targetFor(threadId: string | null): Target | null {
  if (threadId) {
    const known = state.threads.get(threadId) ?? state.loadErrors.get(threadKey(threadId))?.target;
    return known ? { kind: 'thread', threadId, projectId: known.projectId } : null;
  }
  return state.draftProject ? { kind: 'draft', projectId: state.draftProject } : null;
}

export const sourceLabel = (source: 'thread' | 'project' | 'default', kind: Target['kind']) =>
  source === 'thread' ? (kind === 'thread' ? 'this thread' : 'the new thread') : source === 'project' ? 'project default' : 'global default';
