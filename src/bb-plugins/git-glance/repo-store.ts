// Live repository state per thread, shared by the header chip and the pop-up. A
// mounted view holds a lease the server renews into a host watch; snapshots and
// operation updates then arrive over realtime instead of being polled.
import { useEffect, useSyncExternalStore } from 'react';
import type { PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { FetchHealth, OpMessage, OpState, Snapshot, SnapshotMessage, rpcContract } from './contracts.ts';

export interface RepoState {
  root: string | null;
  selected: boolean;
  snapshot: Snapshot | null;
  op: OpState | null;
  fetch: FetchHealth;
  fetchRequestError: string | null;
  error: string | null;
  updatedAt: number | null;
}
type Rpc = PluginRpcClient<typeof rpcContract>;
interface Entry {
  state: RepoState;
  listeners: Set<() => void>;
  holders: number;
  revision: number;
  rpc: Rpc | null;
  timer: ReturnType<typeof setInterval> | null;
}

/** Renew well inside the server's 75 second lease. */
const renewMs = 30_000;
const clientId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
const entries = new Map<string, Entry>();
const empty: RepoState = { root: null, selected: false, snapshot: null, op: null, fetch: { lastSucceededAt: null, failure: null }, fetchRequestError: null, error: null, updatedAt: null };

function entry(threadId: string) {
  let found = entries.get(threadId);
  if (!found) entries.set(threadId, found = { state: empty, listeners: new Set(), holders: 0, revision: 0, rpc: null, timer: null });
  return found;
}
function set(threadId: string, patch: Partial<RepoState>) {
  const item = entry(threadId);
  item.state = { ...item.state, ...patch };
  item.listeners.forEach(listener => listener());
}
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/** Takes or renews the lease and resynchronises; also the recovery path after a missed message. */
export async function renew(threadId: string) {
  const item = entries.get(threadId);
  if (!item?.rpc || item.holders === 0) return;
  const revision = ++item.revision;
  try {
    const { root, selected, snapshot, op, fetch } = await item.rpc.call('watch', { threadId, clientId });
    if (revision !== item.revision || item.holders === 0) return;
    set(threadId, { root, selected, snapshot, op, fetch,
      fetchRequestError: root !== item.state.root || (fetch.lastSucceededAt ?? 0) > (item.state.fetch.lastSucceededAt ?? 0) ? null : item.state.fetchRequestError,
      error: null, updatedAt: Date.now() });
  } catch (cause) { if (revision === item.revision && item.holders > 0) set(threadId, { error: message(cause) }); }
}
export function renewAll() { for (const threadId of entries.keys()) void renew(threadId); }

export function receiveSnapshot(payload: unknown) {
  const { threadIds, root, snapshot } = payload as SnapshotMessage;
  for (const threadId of threadIds ?? []) if (entries.get(threadId)?.holders && entries.get(threadId)?.state.root === root) set(threadId, { snapshot, error: null, updatedAt: Date.now() });
}
export function receiveOp(payload: unknown) {
  const { threadIds, root, op, fetch } = payload as OpMessage;
  for (const threadId of threadIds ?? []) {
    if (entries.get(threadId)?.state.root !== root) continue;
    const current = entries.get(threadId)?.state.op;
    // Ignore an older operation's late update once a newer one has started.
    if (current && current.id !== op.id && current.startedAt > op.startedAt) continue;
    if (entries.get(threadId)?.holders) set(threadId, { op, fetch, ...(op.request.kind === 'fetch' && op.status === 'succeeded' ? { fetchRequestError: null } : {}) });
  }
}

export function fetchRequestFailed(threadId: string, root: string, cause: unknown) {
  if (entry(threadId).state.root === root) set(threadId, { fetchRequestError: message(cause) });
}

export function useRepo(threadId: string, rpc: Rpc): RepoState {
  const item = entry(threadId);
  item.rpc = rpc;
  useEffect(() => {
    const current = entry(threadId);
    if (current.holders++ === 0) {
      void renew(threadId);
      current.timer = setInterval(() => { void renew(threadId); }, renewMs);
    } else if (!current.state.updatedAt) void renew(threadId);
    return () => {
      if (--current.holders > 0) return;
      if (current.timer) clearInterval(current.timer);
      current.timer = null;
      current.revision++;
      current.state = empty;
      void current.rpc?.call('unwatch', { threadId, clientId }).catch(() => {});
    };
  }, [threadId]);
  return useSyncExternalStore(
    listener => { item.listeners.add(listener); return () => { item.listeners.delete(listener); }; },
    () => item.state,
  );
}

if (typeof window !== 'undefined') window.addEventListener('focus', renewAll);
