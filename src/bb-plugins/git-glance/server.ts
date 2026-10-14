import { randomUUID } from 'node:crypto';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, hostSignals, rpcContract, subjectProject, type OpMessage, type Snapshot, type SnapshotMessage } from './contracts.ts';
import { checkoutKey, createLeases, type Checkout } from './src/leases.ts';
import { finish, progress, start, type OpState } from './src/ops.ts';

/** Windows renew every 30 seconds; two missed renewals end the lease. */
const leaseTtlMs = 75_000;
/** A little longer than the host's own git timeout, so the host reports it first. */
const runTimeoutMs = 3 * 60_000 + 10_000;

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract, experimental_signals: hostSignals });
  const leases = createLeases(leaseTtlMs);
  const snapshots = new Map<string, Snapshot>();
  const selecting = new Set<string>();
  const ops = new Map<string, { state: OpState; abort: AbortController | null }>();
  const warn = (message: string, cause?: unknown) =>
    bb.log.warn(`${message}${cause ? `: ${cause instanceof Error ? cause.message : JSON.stringify(cause)}` : ''}`);

  async function environment(threadId: string): Promise<Checkout | null> {
    const projectId = subjectProject(threadId);
    if (projectId !== null) {
      const { sources } = await bb.sdk.projects.get({ projectId });
      const source = sources.find(s => s.isDefault) ?? sources[0];
      return source ? { hostId: source.hostId, root: source.path } : null;
    }
    const { environmentId } = await bb.sdk.threads.get({ threadId });
    if (!environmentId) return null;
    const { hostId, path } = await bb.sdk.environments.get({ environmentId });
    return path ? { hostId, root: path } : null;
  }
  const selectionKey = (threadId: string) => `repository:${threadId}`;
  async function checkout(threadId: string): Promise<Checkout | null> {
    const base = await environment(threadId);
    const selected = await bb.storage.kv.get<{ base: Checkout; root: string }>(selectionKey(threadId));
    return base && selected && checkoutKey(selected.base) === checkoutKey(base) ? { ...base, root: selected.root } : base;
  }
  async function required(threadId: string) {
    const target = await checkout(threadId);
    if (!target) throw new Error('This thread has no checkout.');
    return target;
  }
  function publishSnapshot(target: Checkout, snapshot: Snapshot) {
    snapshots.set(checkoutKey(target), snapshot);
    const threadIds = leases.threads(target);
    if (threadIds.length) bb.realtime.publish('snapshot', { threadIds, root: target.root, snapshot } satisfies SnapshotMessage);
  }
  function setOp(target: Checkout, state: OpState, abort: AbortController | null) {
    ops.set(checkoutKey(target), { state, abort });
    const threadIds = leases.threads(target);
    if (threadIds.length) bb.realtime.publish('op', { threadIds, root: target.root, op: state } satisfies OpMessage);
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
    folders: async ({ threadId, path }) => {
      const base = await environment(threadId);
      if (!base) throw new Error('This thread has no checkout.');
      return host.call('folders', { root: base.root, path }, { hostId: base.hostId, timeoutMs: 30_000 });
    },
    select: async ({ threadId, path }) => {
      if (selecting.has(threadId)) throw new Error('Repository selection is already running.');
      selecting.add(threadId);
      try {
        const base = await environment(threadId);
        if (!base) throw new Error('This thread has no checkout.');
        const previous = await required(threadId);
        if (ops.get(checkoutKey(previous))?.state.status === 'running') throw new Error('Wait for the running Git operation before changing repository.');
        const target = path === null ? base : { ...base, ...(await host.call('select', { root: base.root, path }, { hostId: base.hostId })) };
        await bb.storage.kv.set(selectionKey(threadId), { base, root: target.root });
        for (const emptied of leases.move(threadId, target)) {
          snapshots.delete(checkoutKey(emptied));
          await host.call('unwatch', { root: emptied.root }, { hostId: emptied.hostId });
        }
        const snapshot = await watch(target);
        snapshots.set(checkoutKey(target), snapshot);
        bb.realtime.publish('repository', { threadId });
        return {};
      } finally { selecting.delete(threadId); }
    },
    watch: async ({ threadId, clientId }) => {
      const target = await checkout(threadId);
      if (!target) return { root: null, selected: false, snapshot: { kind: 'none' as const }, op: null };
      leases.touch(target, `${clientId}:${threadId}`, threadId, Date.now());
      const snapshot = await watch(target);
      snapshots.set(checkoutKey(target), snapshot);
      const base = await environment(threadId);
      return { root: target.root, selected: base !== null && checkoutKey(target) !== checkoutKey(base), snapshot, op: ops.get(checkoutKey(target))?.state ?? null };
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
    branches: async ({ threadId }) => {
      const target = await required(threadId);
      return host.call('branches', { root: target.root }, { hostId: target.hostId, timeoutMs: 15_000 });
    },
    run: async ({ threadId, root, request, origin }) => {
      const target = await required(threadId);
      if (selecting.has(threadId) || target.root !== root) throw new Error('Repository changed. Refresh Git status before running an action.');
      const key = checkoutKey(target);
      const snapshot = snapshots.get(key);
      const current = ops.get(key)?.state ?? null;
      const id = randomUUID();
      const state = start(current, { id, request, origin, startedAt: Date.now() }, snapshot?.kind === 'none' ? null : snapshot?.fetchedAt ?? null);
      if (!state) return { op: current };
      const abort = new AbortController();
      setOp(target, state, abort);
      // Runs past this RPC: the app follows progress and the result over realtime.
      void host.call('run', { root: target.root, request, opId: id }, { hostId: target.hostId, timeoutMs: runTimeoutMs, signal: abort.signal })
        .catch(cause => ({ ok: false as const, failure: { reason: abort.signal.aborted ? 'cancelled' as const : 'unknown' as const,
          message: cause instanceof Error ? cause.message : String(cause) } }))
        .then(result => {
          const next = finish(ops.get(key)?.state ?? null, id, result, Date.now());
          if (next) setOp(target, next, null);
        });
      return { op: state };
    },
    cancel: async ({ threadId, root }) => {
      const target = await required(threadId);
      if (target.root !== root) throw new Error('Repository changed. Refresh Git status before cancelling.');
      ops.get(checkoutKey(target))?.abort?.abort();
      return {};
    },
  });
}
