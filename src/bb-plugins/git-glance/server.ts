import { randomUUID } from 'node:crypto';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, hostSignals, rpcContract, type OpMessage, type Snapshot, type SnapshotMessage } from './contracts.ts';
import { checkoutKey, createLeases, type Checkout } from './src/leases.ts';
import { finish, progress, start, type OpState } from './src/ops.ts';

/** Windows renew every 30 seconds; two missed renewals end the lease. */
const leaseTtlMs = 75_000;
const syncTimeoutMs = 3 * 60_000 + 10_000;

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract, experimental_signals: hostSignals });
  const leases = createLeases(leaseTtlMs);
  const snapshots = new Map<string, Snapshot>();
  const ops = new Map<string, { state: OpState; abort: AbortController | null }>();
  const warn = (message: string, cause?: unknown) =>
    bb.log.warn(`${message}${cause ? `: ${cause instanceof Error ? cause.message : JSON.stringify(cause)}` : ''}`);

  async function checkout(threadId: string): Promise<Checkout | null> {
    const { environmentId } = await bb.sdk.threads.get({ threadId });
    if (!environmentId) return null;
    const { hostId, path } = await bb.sdk.environments.get({ environmentId });
    return path ? { hostId, root: path } : null;
  }
  async function required(threadId: string) {
    const target = await checkout(threadId);
    if (!target) throw new Error('This thread has no checkout.');
    return target;
  }
  function publishSnapshot(target: Checkout, snapshot: Snapshot) {
    snapshots.set(checkoutKey(target), snapshot);
    const threadIds = leases.threads(target);
    if (threadIds.length) bb.realtime.publish('snapshot', { threadIds, snapshot } satisfies SnapshotMessage);
  }
  function setOp(target: Checkout, state: OpState, abort: AbortController | null) {
    ops.set(checkoutKey(target), { state, abort });
    const threadIds = leases.threads(target);
    if (threadIds.length) bb.realtime.publish('op', { threadIds, op: state } satisfies OpMessage);
  }
  const watch = (target: Checkout) => host.call('watch', { root: target.root }, { hostId: target.hostId, timeoutMs: 20_000 });

  host.experimental_onSignal('snapshot', ({ hostId, payload }) => publishSnapshot({ hostId, root: payload.root }, payload.snapshot));
  host.experimental_onSignal('progress', ({ hostId, payload }) => {
    const target = { hostId, root: payload.root };
    const current = ops.get(checkoutKey(target));
    const next = progress(current?.state ?? null, payload.opId, payload.progress);
    if (next) setOp(target, next, current?.abort ?? null);
  });
  // A crashed worker takes its watches with it; restart the ones still leased.
  host.experimental_onWorkerExit(({ hostId }) => {
    for (const target of leases.checkouts(hostId)) {
      watch(target).then(snapshot => publishSnapshot(target, snapshot), cause => warn(`Re-watching ${target.root} failed`, cause));
    }
  });
  const sweep = setInterval(() => {
    for (const target of leases.sweep(Date.now())) {
      snapshots.delete(checkoutKey(target));
      host.call('unwatch', { root: target.root }, { hostId: target.hostId }).catch(cause => warn(`Unwatching ${target.root} failed`, cause));
    }
  }, 20_000);
  bb.onDispose(() => clearInterval(sweep));

  bb.rpc.register(rpcContract, {
    watch: async ({ threadId, clientId }) => {
      const target = await checkout(threadId);
      if (!target) return { snapshot: { kind: 'none' as const }, op: null };
      leases.touch(target, `${clientId}:${threadId}`, threadId, Date.now());
      const snapshot = await watch(target);
      snapshots.set(checkoutKey(target), snapshot);
      return { snapshot, op: ops.get(checkoutKey(target))?.state ?? null };
    },
    unwatch: async ({ threadId, clientId }) => {
      const target = await checkout(threadId);
      const emptied = target && leases.release(target, `${clientId}:${threadId}`);
      if (emptied) {
        snapshots.delete(checkoutKey(emptied));
        await host.call('unwatch', { root: emptied.root }, { hostId: emptied.hostId });
      }
      return {};
    },
    diff: async ({ threadId, ...input }) => {
      const target = await required(threadId);
      return host.call('diff', { root: target.root, ...input }, { hostId: target.hostId, timeoutMs: 15_000 });
    },
    commit: async ({ threadId, sha }) => {
      const target = await required(threadId);
      return host.call('commit', { root: target.root, sha }, { hostId: target.hostId, timeoutMs: 15_000 });
    },
    sync: async ({ threadId, op, origin }) => {
      const target = await required(threadId);
      const key = checkoutKey(target);
      const snapshot = snapshots.get(key);
      const current = ops.get(key)?.state ?? null;
      const id = randomUUID();
      const state = start(current, { id, kind: op, origin, startedAt: Date.now() }, snapshot?.kind === 'none' ? null : snapshot?.fetchedAt ?? null);
      if (!state) return { op: current };
      const abort = new AbortController();
      setOp(target, state, abort);
      // Runs past this RPC: the app follows progress and the result over realtime.
      void host.call('sync', { root: target.root, op, opId: id }, { hostId: target.hostId, timeoutMs: syncTimeoutMs, signal: abort.signal })
        .catch(cause => ({ ok: false as const, failure: { reason: abort.signal.aborted ? 'cancelled' as const : 'unknown' as const,
          message: cause instanceof Error ? cause.message : String(cause) } }))
        .then(result => {
          const next = finish(ops.get(key)?.state ?? null, id, result, Date.now());
          if (next) setOp(target, next, null);
        });
      return { op: state };
    },
    cancel: async ({ threadId }) => {
      ops.get(checkoutKey(await required(threadId)))?.abort?.abort();
      return {};
    },
  });
}
