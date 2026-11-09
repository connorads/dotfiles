import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, hostSignals, rpcContract, subjectProject, type FetchHealth, type OpMessage, type Snapshot, type SnapshotMessage } from './contracts.ts';
import { checkoutKey, createLeases, type Checkout } from './src/leases.ts';
import { finish, progress, start, type OpState } from './src/ops.ts';

/** Windows renew every 30 seconds; two missed renewals end the lease. */
const leaseTtlMs = 75_000;
/** A little longer than the host's own git timeout, so the host reports it first. */
const runTimeoutMs = 10 * 60_000 + 10_000;

export default function plugin(bb: BbPluginApi) {
  bb.agents.contributeInstructions(() => 'When pointing the user to a Git checkout for review, emit an inline-code reference: git-checkout://HOST_ID/absolute/checkout/path. Replace HOST_ID with the checkout host ID. URI-encode spaces, #, ? and % in path segments. Verify the exact checkout root and host; do not infer it from a branch name. Git Glance opens that checkout without moving the thread or switching branches. Say whether the proposed changes are working files, commits or an unapplied patch. An unapplied patch is not visible in checkout status.');
  const settings = bb.settings.define({
    messageModel: { type: 'string', label: 'Commit message model', default: 'gpt-6-luna', experimental_schema: z.string().trim().min(1).max(200) },
    codexExecutable: { type: 'string', label: 'Codex executable', default: 'codex', experimental_schema: z.string().trim().min(1).max(4096) },
  });
  const drafts = new Map<string, { requestId: string; abort: AbortController }>();
  bb.onDispose(() => { for (const draft of drafts.values()) draft.abort.abort(); });
  const host = bb.hosts.experimental_client({ contract: hostContract, experimental_signals: hostSignals });
  const leases = createLeases(leaseTtlMs);
  const fetches = new Map<string, FetchHealth>();
  const fetchHealth = (target: Checkout): FetchHealth => fetches.get(checkoutKey(target)) ?? { lastSucceededAt: null, failure: null };
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
  const knownKey = (hostId: string) => `known-checkouts:${hostId}`;
  const knownSchema = z.array(z.string().min(1)).max(64);
  async function known(hostId: string) {
    return knownSchema.safeParse(await bb.storage.kv.get(knownKey(hostId))).data ?? [];
  }
  // Paths live in private plugin app data, with no commit-object index.
  async function rememberRoot(target: Checkout) {
    const paths = await known(target.hostId);
    if (paths[0] !== target.root) await bb.storage.kv.set(knownKey(target.hostId),
      [target.root, ...paths.filter(path => path !== target.root)].slice(0, 64));
  }
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
    const threadIds = leases.threads(target);
    if (threadIds.length) bb.realtime.publish('snapshot', { threadIds, root: target.root, snapshot } satisfies SnapshotMessage);
  }
  function setOp(target: Checkout, state: OpState, abort: AbortController | null) {
    ops.set(checkoutKey(target), { state, abort });
    if (state.request.kind === 'fetch' && state.status !== 'running') {
      const previous = fetchHealth(target);
      fetches.set(checkoutKey(target), state.status === 'succeeded'
        ? { lastSucceededAt: state.finishedAt, failure: null }
        : { ...previous, failure: state.failure });
    }
    const threadIds = leases.threads(target);
    if (threadIds.length) bb.realtime.publish('op', { threadIds, root: target.root, op: state, fetch: fetchHealth(target) } satisfies OpMessage);
  }
  const watch = (target: Checkout) => host.call('watch', { root: target.root }, { hostId: target.hostId, timeoutMs: 20_000 });
  async function remember(threadId: string, base: Checkout, target: Checkout) {
    await bb.storage.kv.set(selectionKey(threadId), { base, root: target.root });
    await rememberRoot(target);
    for (const emptied of leases.move(threadId, target)) {
      await host.call('unwatch', { root: emptied.root }, { hostId: emptied.hostId });
    }
    await watch(target);
    bb.realtime.publish('repository', { threadId });
    return {};
  }

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
      host.call('unwatch', { root: target.root }, { hostId: target.hostId }).catch(cause => warn(`Unwatching ${target.root} failed`, cause));
    }
  }, 20_000);
  bb.onDispose(() => clearInterval(sweep));

  bb.rpc.register(rpcContract, {
    findCommit: async ({ threadId, sha }) => {
      const target = await required(threadId);
      const search = (roots: string[]) => host.call('findCommit', { roots, sha }, { hostId: target.hostId, timeoutMs: 7000 });
      const selected = await search([target.root]);
      if (selected.matches.length) return { ...selected, hostId: target.hostId };
      const sources = await Promise.allSettled([
        bb.sdk.projects.list(),
        bb.sdk.environments.list({ hostId: target.hostId, status: 'ready', limit: 128, offset: 0 }),
      ]);
      const roots = new Set(await known(target.hostId));
      let unchecked = selected.unchecked;
      const [projects, environments] = sources;
      if (projects.status === 'fulfilled') {
        for (const project of projects.value) for (const source of project.sources) {
          if (source.hostId === target.hostId) roots.add(source.path);
        }
      } else unchecked++;
      if (environments.status === 'fulfilled') {
        for (const env of environments.value) if (env.hostId === target.hostId && env.path) roots.add(env.path);
        if (environments.value.length === 128) unchecked++;
      } else unchecked++;
      roots.delete(target.root);
      const paths = [...roots];
      const result = await search(paths.slice(0, 128));
      unchecked += result.unchecked + Math.max(0, paths.length - 128);
      if (result.matches.length) return { ...result, hostId: target.hostId, unchecked };
      const discovered = await bb.sdk.hosts.experimental_discoverRepos({ hostId: target.hostId, signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (!discovered) return { ...result, hostId: target.hostId, unchecked: unchecked + 1 };
      const checked = new Set([target.root, ...paths.slice(0, 128)]);
      const extra = [...new Set(discovered.repos.map(repo => repo.path))].filter(path => !checked.has(path));
      if (extra.length === 0) return { ...result, hostId: target.hostId, unchecked: unchecked + Number(discovered.truncated) };
      const found = await search(extra.slice(0, 128));
      return { ...found, hostId: target.hostId,
        unchecked: unchecked + found.unchecked + Number(discovered.truncated) + Math.max(0, extra.length - 128) };
    },
    reviewTarget: async ({ threadId, root }) => {
      const target = await required(threadId);
      if (target.root !== root) throw new Error('Repository selection changed. Reopen Git Glance and try again.');
      return { hostId: target.hostId, path: target.root };
    },
    openCheckout: async ({ threadId, hostId, path }) => {
      if (selecting.has(threadId)) throw new Error('Repository selection is already running.');
      selecting.add(threadId);
      try {
        const base = await required(threadId);
        if (base.hostId !== hostId) throw new Error('The checkout host differs from this thread host. Open it in a thread on that host.');
        if (ops.get(checkoutKey(base))?.state.status === 'running') throw new Error('Wait for the running Git operation before changing repository.');
        const target = { hostId, ...(await host.call('checkout', { root: path }, { hostId })) };
        const environmentBase = await environment(threadId);
        if (!environmentBase) throw new Error('This thread has no checkout.');
        return await remember(threadId, environmentBase, target);
      } finally { selecting.delete(threadId); }
    },
    generateMessage: async ({ threadId, requestId, head, index, draftKey }) => {
      if (drafts.has(threadId)) throw new Error('Message generation is already running.');
      const abort = new AbortController();
      drafts.set(threadId, { requestId, abort });
      try {
        const target = await required(threadId);
        const checked = await host.call('review', { root: target.root }, { hostId: target.hostId, timeoutMs: 20_000, signal: abort.signal });
        if (JSON.stringify([target.hostId, checked.draftKey]) !== draftKey) throw new Error('Repository changed. Review the index again.');
        const { messageModel, codexExecutable } = await settings.get();
        const result = await host.call('generateMessage', { root: target.root, head, index, draftKey: checked.draftKey,
          model: messageModel, executable: codexExecutable }, { hostId: target.hostId, timeoutMs: 100_000, signal: abort.signal });
        const after = await required(threadId);
        if (checkoutKey(after) !== checkoutKey(target)) throw new Error('Repository changed. Generate again.');
        return result;
      } finally { drafts.delete(threadId); }
    },
    cancelMessage: ({ threadId, requestId }) => {
      const draft = drafts.get(threadId);
      if (draft?.requestId === requestId) draft.abort.abort();
      return {};
    },
    folders: async ({ threadId, path }) => {
      const base = await environment(threadId);
      if (!base) throw new Error('This thread has no checkout.');
      return host.call('folders', { root: base.root, path }, { hostId: base.hostId, timeoutMs: 30_000 });
    },
    select: async ({ threadId, path, worktree }) => {
      if (selecting.has(threadId)) throw new Error('Repository selection is already running.');
      selecting.add(threadId);
      try {
        const base = await environment(threadId);
        if (!base) throw new Error('This thread has no checkout.');
        const previous = await required(threadId);
        if (ops.get(checkoutKey(previous))?.state.status === 'running') throw new Error('Wait for the running Git operation before changing repository.');
        const target = path === null ? base : { ...base, ...(await host.call('select', { root: base.root, path, ...worktree === undefined ? {} : { worktree } }, { hostId: base.hostId })) };
        return await remember(threadId, base, target);
      } finally { selecting.delete(threadId); }
    },
    watch: async ({ threadId, clientId }) => {
      const target = await checkout(threadId);
      if (!target) return { root: null, selected: false, snapshot: { kind: 'none' as const }, op: null, fetch: { lastSucceededAt: null, failure: null } };
      leases.touch(target, `${clientId}:${threadId}`, threadId, Date.now());
      const snapshot = await watch(target);
      const base = await environment(threadId);
      return { root: target.root, selected: base !== null && checkoutKey(target) !== checkoutKey(base), snapshot, op: ops.get(checkoutKey(target))?.state ?? null, fetch: fetchHealth(target) };
    },
    unwatch: async ({ threadId, clientId }) => {
      const target = await checkout(threadId);
      const emptied = target && leases.release(target, `${clientId}:${threadId}`);
      if (emptied) {
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
    review: async ({ threadId }) => {
      const target = await required(threadId);
      const result = await host.call('review', { root: target.root }, { hostId: target.hostId, timeoutMs: 20_000 });
      return { ...result, draftKey: JSON.stringify([target.hostId, result.draftKey]) };
    },
    branches: async ({ threadId }) => {
      const target = await required(threadId);
      return host.call('branches', { root: target.root }, { hostId: target.hostId, timeoutMs: 15_000 });
    },
    run: async ({ threadId, root, request, origin }) => {
      const target = await required(threadId);
      if (selecting.has(threadId) || target.root !== root) throw new Error('Repository changed. Refresh Git status before running an action.');
      const key = checkoutKey(target);
      const current = ops.get(key)?.state ?? null;
      const id = randomUUID();
      const state = start(current, { id, request, origin, startedAt: Date.now() }, fetchHealth(target).lastSucceededAt);
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
