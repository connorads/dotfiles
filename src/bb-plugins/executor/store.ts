// One module store shared by every header chip, the overlay, the settings
// section and the command. State arrives by RPC; realtime only says "refetch".
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { ConnectionView, OwnerResolutionView, rpcContract, ScopedChoiceView, StateView } from './contracts.ts';

export type Rpc = PluginRpcClient<typeof rpcContract>;
export type Choice = { kind: 'default' } | { kind: 'connection'; id: string } | { kind: 'off' };
export type ResolutionSource = 'thread' | 'owner' | 'project' | 'default';
export type Anchor = { top: number; right: number; bottom: number; left: number } | null;
/** instant: opened by keyboard, so it appears without an entrance. */
export type Open = { threadId: string | null; projectId: string | null; anchor: Anchor; instant: boolean } | null;

/**
 * A failed pick or add that may have outlived its popover, for a thread or, with a null threadId, the draft.
 * Cleared when that popover closes or the thread is picked again.
 */
export type Unsaved = { threadId: string | null; message: string } | null;
/**
 * loadError: why the last state read failed; shown only while there is no view to keep.
 * saves: the pick whose save is in flight per thread, so a popover reopened mid-save waits for it too.
 */
interface State {
  view: StateView | null;
  loadError: string | null;
  choices: ReadonlyMap<string, Choice>;
  owners: ReadonlyMap<string, OwnerResolutionView | null>;
  saves: ReadonlyMap<string, Choice>;
  draft: Choice;
  open: Open;
  unsaved: Unsaved;
}
let state: State = {
  view: null,
  loadError: null,
  choices: new Map(),
  owners: new Map(),
  saves: new Map(),
  draft: { kind: 'default' },
  open: null,
  unsaved: null,
};
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

/** Remember each mounted thread's projectId and the active draft's projectId so keyboard ⌥E knows the project. */
const threadProjects = new Map<string, string>();
let activeDraftProject: string | null = null;
export function rememberThreadProject(threadId: string, projectId: string | null | undefined) {
  if (projectId) threadProjects.set(threadId, projectId);
}
export function setDraftProject(projectId: string | null) {
  activeDraftProject = projectId;
}

export const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/** A failed read keeps the last view and the last load error, so a retry button stays where it is. */
let reads = 0;
export async function refresh() {
  // Only the latest read lands: an older one that answers late would hide a connection added since.
  const read = ++reads;
  try {
    const view = await rpc().call('state', null);
    if (read === reads) set({ view, loadError: null });
  } catch (cause) {
    if (read === reads) set({ loadError: message(cause) });
  }
}

/** Triggers a read-only server health probe. Never throws; results arrive via `state`. */
export async function checkAll(force = false) {
  if (!client) return;
  try {
    await client.call('checkAll', { force });
    await refresh();
  } catch { /* health checks are best-effort */ }
}

export async function checkOne(id: string, force = true) {
  if (!client) return;
  try {
    await client.call('check', { id, force });
    await refresh();
  } catch { /* health checks are best-effort */ }
}

/** Loads whether a thread inherits from a parent/workflow owner thread. Best-effort. */
export async function loadOwner(threadId: string, projectId?: string | null) {
  if (!client) return;
  try {
    const owner = await client.call('threadOwner', { threadId, projectId: projectId ?? null });
    const owners = new Map(state.owners);
    owners.set(threadId, owner);
    set({ owners });
  } catch { /* older test harnesses may not mock threadOwner */ }
}

export async function setProjectChoice(projectId: string, choice: Choice) {
  await rpc().call('setProjectChoice', { projectId, choice });
  await refresh();
}

export async function setGlobalDefault(choice: ScopedChoiceView) {
  await rpc().call('setDefault', { choice });
  await refresh();
}

/** Picks per thread, so a read that started before a pick cannot overwrite it. */
const picks = new Map<string, number>();
/** Saves in flight per thread: a read during one would show the old choice as if the pick were undone. */
const saving = new Map<string, number>();
/** The last choice the server confirmed per thread: what a failed save falls back to. */
const confirmed = new Map<string, Choice>();

export async function loadChoice(threadId: string) {
  const pick = picks.get(threadId);
  try {
    const choice = await rpc().call('threadChoice', { threadId });
    if (picks.get(threadId) !== pick || saving.get(threadId)) return;
    confirmed.set(threadId, choice);
    set({ choices: new Map(state.choices).set(threadId, choice) });
  } catch { /* keep the last choice */ }
}

export async function choose(threadId: string | null, choice: Choice) {
  if (!threadId) { set({ draft: choice }); return; }
  const pick = (picks.get(threadId) ?? 0) + 1;
  picks.set(threadId, pick);
  saving.set(threadId, (saving.get(threadId) ?? 0) + 1);
  set({
    choices: new Map(state.choices).set(threadId, choice), saves: new Map(state.saves).set(threadId, choice),
    unsaved: state.unsaved?.threadId === threadId ? null : state.unsaved,
  });
  let failed = false;
  try {
    await rpc().call('setThreadChoice', { threadId, choice });
    confirmed.set(threadId, choice);
  } catch (cause) {
    // The server kept its last confirmed choice, so the chip must name it again unless a later pick replaced this one.
    // The failure stays in the store: the popover that made the pick may have closed already.
    if (picks.get(threadId) === pick) {
      failed = true;
      const choices = new Map(state.choices);
      const last = confirmed.get(threadId);
      if (last) choices.set(threadId, last); else choices.delete(threadId);
      set({ choices, unsaved: { threadId, message: `${switchFailure(choice)} ${message(cause)}` } });
    }
    throw cause;
  } finally {
    const left = (saving.get(threadId) ?? 1) - 1;
    saving.set(threadId, left);
    if (left === 0) {
      const saves = new Map(state.saves);
      saves.delete(threadId);
      set({ saves });
      // A pick made before the first read returned has no confirmed choice to fall back to: ask the server.
      if (failed) void loadChoice(threadId);
    }
  }
}

/** An add that failed after its popover closed: the chip and the next popover say why. */
export function reportUnsaved(threadId: string | null, text: string) { set({ unsaved: { threadId, message: text } }); }

/** The popover shows a thread's failed pick itself while it is open. */
export function dismissUnsaved(threadId: string) {
  if (state.unsaved?.threadId === threadId) set({ unsaved: null });
}

function switchFailure(choice: Choice): string {
  if (choice.kind === 'off') return 'Could not turn Executor off.';
  if (choice.kind === 'default') return 'Could not switch to the default connection.';
  const name = state.view?.connections.find(c => c.id === choice.id)?.name;
  return `Could not switch to ${name ?? 'the new connection'}.`;
}

export function resetDraft() { set({ draft: { kind: 'default' } }); }
export function draftChoice() { return state.draft; }

export type Resolved =
  | { kind: 'connection'; id: string; name: string; status: ConnectionView['status']; connection: ConnectionView; source: ResolutionSource; viaDefault: boolean }
  | { kind: 'off'; source: ResolutionSource }
  | { kind: 'none'; source: ResolutionSource };

/** Resolves the global default choice from `StateView`, tolerating older fixtures without `defaultChoice`. */
export function globalDefaultOf(view: StateView | null): ScopedChoiceView | null {
  if (!view) return null;
  if (view.defaultChoice !== undefined) return view.defaultChoice;
  const fallback = view.connections.find(c => c.isDefault);
  return fallback ? { kind: 'connection', id: fallback.id } : null;
}

/** Mirrors the server's 4-level hierarchy: thread → owner → project → global default. */
export function resolve(
  view: StateView | null,
  choice: Choice | undefined,
  context: { projectId?: string | null; owner?: OwnerResolutionView | null } = {},
): Resolved {
  const connections = view?.connections ?? [];
  const byId = (id: string) => connections.find(c => c.id === id);

  if (choice?.kind === 'off') return { kind: 'off', source: 'thread' };
  if (choice?.kind === 'connection') {
    const found = byId(choice.id);
    if (found) return { kind: 'connection', id: found.id, name: found.name, status: found.status, connection: found, source: 'thread', viaDefault: false };
  }

  if (context.owner) {
    if (context.owner.kind === 'off') return { kind: 'off', source: 'owner' };
    if (context.owner.kind === 'connection') {
      const found = byId(context.owner.id);
      if (found) return { kind: 'connection', id: found.id, name: found.name, status: found.status, connection: found, source: 'owner', viaDefault: true };
    }
    return { kind: 'none', source: 'owner' };
  }

  const projectChoice = context.projectId
    ? view?.projects?.find(p => p.id === context.projectId)?.choice ?? null
    : null;
  if (projectChoice) {
    if (projectChoice.kind === 'off') return { kind: 'off', source: 'project' };
    const found = byId(projectChoice.id);
    if (found) return { kind: 'connection', id: found.id, name: found.name, status: found.status, connection: found, source: 'project', viaDefault: true };
  }

  const globalDefault = globalDefaultOf(view);
  if (globalDefault) {
    if (globalDefault.kind === 'off') return { kind: 'off', source: 'default' };
    const found = byId(globalDefault.id);
    if (found) return { kind: 'connection', id: found.id, name: found.name, status: found.status, connection: found, source: 'default', viaDefault: true };
  }

  return { kind: 'none', source: 'default' };
}

export function sourceTag(source: ResolutionSource): string | null {
  if (source === 'thread') return null;
  if (source === 'owner') return 'parent';
  return source;
}

export type HealthKind = 'ok' | 'degraded' | 'reauth' | 'unreachable' | 'signed-out' | 'signing-in' | 'checking' | 'error' | 'unknown';

export function healthKind(connection: ConnectionView, error?: string): HealthKind {
  if (connection.status === 'signing-in') return 'signing-in';
  if (connection.status === 'signed-out') {
    return connection.health?.state === 'reauth' ? 'reauth' : 'signed-out';
  }
  const h = connection.health?.state ?? 'unknown';
  if (h === 'checking') return 'checking';
  if (h === 'reauth') return 'reauth';
  if (h === 'unreachable') return 'unreachable';
  if (h === 'degraded') return 'degraded';
  if (error) return 'error';
  if (h === 'ok') return 'ok';
  return 'unknown';
}

export function dotStateFor(kind: HealthKind): 'ok' | 'warn' | 'danger' | 'checking' | 'muted' {
  if (kind === 'ok') return 'ok';
  if (kind === 'checking' || kind === 'signing-in') return 'checking';
  if (kind === 'reauth' || kind === 'unreachable' || kind === 'error') return 'danger';
  if (kind === 'degraded' || kind === 'signed-out') return 'warn';
  return 'muted';
}

/** The chip label's note on a connection that cannot run tools cleanly. */
export function statusNote(resolved: Resolved, error?: string): string {
  if (resolved.kind !== 'connection') return '';
  const kind = healthKind(resolved.connection, error);
  if (kind === 'reauth') return ', sign-in rejected';
  if (kind === 'signed-out') return ', signed out';
  if (kind === 'signing-in') return ', signing in';
  if (kind === 'unreachable') return ', offline';
  if (kind === 'degraded') return ', app needs auth';
  if (kind === 'error') return ', error';
  return '';
}

const chipSelector = '[data-executor-chip]';
/** The chip the user can see: split panes each mount one. */
export function visibleChip(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(chipSelector)).find(chip => chip.getClientRects().length > 0) ?? null;
}

export function toggle(threadId: string | null, via: 'pointer' | 'keyboard', from?: HTMLElement, projectId?: string | null) {
  if (state.open) { close(); return; }
  const resolvedProject = projectId !== undefined
    ? projectId
    : threadId ? (threadProjects.get(threadId) ?? null) : activeDraftProject;
  const box = (from ?? visibleChip())?.getBoundingClientRect();
  set({
    open: {
      threadId,
      projectId: resolvedProject,
      anchor: box ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left } : null,
      instant: via === 'keyboard',
    },
  });
  void refresh();
  if (threadId) {
    void loadChoice(threadId);
    void loadOwner(threadId, resolvedProject);
  }
}
/** Closing clears only the closed popover's thread's failure: another thread's chip may still be explaining one. */
export function close() { set({ open: null, unsaved: state.unsaved?.threadId === state.open?.threadId ? null : state.unsaved }); }

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

export function timeAgo(at: number, now: number): string {
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 15) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}
