// Live repository state per thread, shared by the header chip and the pop-up. A
// mounted view holds a lease the server renews into a host watch; snapshots and
// operation updates then arrive over realtime instead of being polled.
import { useEffect, useSyncExternalStore } from 'react';
import type { PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { OpMessage, OpState, Snapshot, SnapshotMessage, rpcContract } from './contracts.ts';

export interface RepoState {
  snapshot: Snapshot | null;
  op: OpState | null;
  error: string | null;
  updatedAt: number | null;
}
type Rpc = PluginRpcClient<typeof rpcContract>;
interface Entry {
  state: RepoState;
  listeners: Set<() => void>;
  holders: number;
  rpc: Rpc | null;
  timer: ReturnType<typeof setInterval> | null;
}

/** Renew well inside the server's 75 second lease. */
const renewMs = 30_000;
const clientId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
const entries = new Map<string, Entry>();
const empty: RepoState = { snapshot: null, op: null, error: null, updatedAt: null };

function entry(threadId: string) {
  let found = entries.get(threadId);
  if (!found) entries.set(threadId, found = { state: empty, listeners: new Set(), holders: 0, rpc: null, timer: null });
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
  try {
    const { snapshot, op } = await item.rpc.call('watch', { threadId, clientId });
    set(threadId, { snapshot, op, error: null, updatedAt: Date.now() });
  } catch (cause) { set(threadId, { error: message(cause) }); }
}
export function renewAll() { for (const threadId of entries.keys()) void renew(threadId); }

export function receiveSnapshot(payload: unknown) {
  const { threadIds, snapshot } = payload as SnapshotMessage;
  for (const threadId of threadIds ?? []) if (entries.get(threadId)?.holders) set(threadId, { snapshot, error: null, updatedAt: Date.now() });
}
export function receiveOp(payload: unknown) {
  const { threadIds, op } = payload as OpMessage;
  for (const threadId of threadIds ?? []) {
    const current = entries.get(threadId)?.state.op;
    // Ignore an older operation's late update once a newer one has started.
    if (current && current.id !== op.id && current.startedAt > op.startedAt) continue;
    if (entries.get(threadId)?.holders) set(threadId, { op });
  }
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
