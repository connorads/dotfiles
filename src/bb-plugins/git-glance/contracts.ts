import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

const area = z.enum(['conflicted', 'staged', 'unstaged', 'untracked']);
const change = z.object({
  path: z.string(), origPath: z.string().nullable(), area,
  code: z.enum(['A', 'C', 'D', 'M', 'R', 'T', 'U', '?']),
  added: z.number().nullable(), removed: z.number().nullable(),
});
const commit = z.object({
  sha: z.string(), parents: z.array(z.string()), author: z.string(), time: z.number(), subject: z.string(),
  refs: z.array(z.object({ name: z.string(), kind: z.enum(['head', 'local', 'remote', 'tag']) })),
  unpushed: z.boolean(),
});
export const snapshotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.enum(['repo', 'dotfiles']),
    name: z.string(),
    branch: z.object({
      head: z.string().nullable(), oid: z.string().nullable(), upstream: z.string().nullable(),
      ahead: z.number(), behind: z.number(),
    }),
    operation: z.enum(['bisect', 'cherry-pick', 'merge', 'rebase', 'revert']).nullable(),
    /** Newest first; `index` is its current `stash@{n}`. */
    stashes: z.array(z.object({ sha: z.string(), index: z.number(), subject: z.string(), time: z.number() })),
    /** When FETCH_HEAD last changed, in milliseconds; null before the first fetch. */
    fetchedAt: z.number().nullable(),
    remotes: z.array(z.string()),
    changes: z.array(change),
    /** Changes past the display cap, which the list omits. */
    hidden: z.number(),
    commits: z.array(commit),
  }),
]);
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Repo = Extract<Snapshot, { kind: 'repo' | 'dotfiles' }>;
export type Change = z.infer<typeof change>;
export type Commit = z.infer<typeof commit>;

const opKind = z.enum(['fetch', 'pull', 'push']);
const stashSha = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/);
/** Every mutating action, so each shares one lifecycle: one at a time, progress, a result. */
const opRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fetch') }), z.object({ kind: z.literal('pull') }), z.object({ kind: z.literal('push') }),
  /** `track`: create a local branch from the remote branch `branch` names. */
  z.object({ kind: z.literal('switch'), branch: z.string().min(1), track: z.boolean() }),
  /** Stashes are named by sha, never `stash@{n}`, which shifts as others are dropped. */
  z.object({ kind: z.literal('stash-apply'), sha: stashSha }),
  z.object({ kind: z.literal('stash-pop'), sha: stashSha }),
  z.object({ kind: z.literal('stash-drop'), sha: stashSha }),
]);
export type OpRequest = z.infer<typeof opRequest>;
export const branchSchema = z.object({
  name: z.string(), kind: z.enum(['local', 'remote']), current: z.boolean(), upstream: z.string().nullable(),
  ahead: z.number(), behind: z.number(), gone: z.boolean(), time: z.number(), subject: z.string(),
});
export type Branch = z.infer<typeof branchSchema>;
const failure = z.object({
  reason: z.enum(['auth', 'cancelled', 'conflict', 'diverged', 'dirty', 'locked', 'network', 'no-remote', 'rejected', 'timeout', 'unknown']),
  message: z.string(),
});
const progress = z.object({ phase: z.string(), percent: z.number().nullable() });
const opResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), summary: z.string() }),
  z.object({ ok: z.literal(false), failure }),
]);
const opBase = { id: z.string(), request: opRequest, origin: z.enum(['user', 'auto']), startedAt: z.number() };
export const opStateSchema = z.discriminatedUnion('status', [
  z.object({ ...opBase, status: z.literal('running'), progress: progress.nullable() }),
  z.object({ ...opBase, status: z.literal('succeeded'), summary: z.string(), finishedAt: z.number() }),
  z.object({ ...opBase, status: z.literal('failed'), failure, finishedAt: z.number() }),
]);
export type OpState = z.infer<typeof opStateSchema>;
export type OpKind = z.infer<typeof opKind>;
export type FailureReason = z.infer<typeof failure>['reason'];

const sha = z.string().regex(/^[0-9a-f]{4,64}$/);
/** A file's change either in the working tree (by area) or in one commit. */
const diffInput = {
  path: z.string(), origPath: z.string().nullable(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('work-tree'), area }),
    z.object({ kind: z.literal('commit'), sha }),
  ]),
};
export type DiffSource = z.infer<typeof diffInput.source>;
export const commitDetailSchema = z.object({
  sha: z.string(), parents: z.array(z.string()), subject: z.string(), body: z.string(),
  author: z.string(), authorEmail: z.string(), authoredAt: z.number(),
  committer: z.string(), committedAt: z.number(),
  files: z.array(z.object({
    path: z.string(), origPath: z.string().nullable(), code: z.enum(['A', 'C', 'D', 'M', 'R', 'T']),
    added: z.number().nullable(), removed: z.number().nullable(),
  })),
  /** Files past the display cap, which the list omits. */
  hidden: z.number(),
});
export type CommitDetail = z.infer<typeof commitDetailSchema>;
const diffOutput = z.object({ patch: z.string(), truncated: z.boolean() });
const root = z.string().min(1);

export const hostContract = defineRpcContract({
  /** Start watching (idempotent) and return the current snapshot. */
  watch: { input: z.object({ root }), output: snapshotSchema },
  unwatch: { input: z.object({ root }), output: z.object({}) },
  diff: { input: z.object({ root, ...diffInput }), output: diffOutput },
  commit: { input: z.object({ root, sha }), output: commitDetailSchema },
  run: { input: z.object({ root, request: opRequest, opId: z.string() }), output: opResult },
  branches: { input: z.object({ root }), output: z.array(branchSchema) },
});
export const hostSignals = {
  snapshot: { payload: z.object({ root, snapshot: snapshotSchema }) },
  progress: { payload: z.object({ root, opId: z.string(), progress }) },
};

const thread = { threadId: z.string().min(1) };
/** Identifies one app window's interest in one thread, for leases. */
const holder = { ...thread, clientId: z.string().min(1) };
export const rpcContract = defineRpcContract({
  watch: { input: z.object(holder), output: z.object({ snapshot: snapshotSchema, op: opStateSchema.nullable() }) },
  unwatch: { input: z.object(holder), output: z.object({}) },
  diff: { input: z.object({ ...thread, ...diffInput }), output: diffOutput },
  commit: { input: z.object({ ...thread, sha }), output: commitDetailSchema },
  run: { input: z.object({ ...thread, request: opRequest, origin: z.enum(['user', 'auto']) }), output: z.object({ op: opStateSchema.nullable() }) },
  branches: { input: z.object(thread), output: z.array(branchSchema) },
  cancel: { input: z.object(thread), output: z.object({}) },
});

/** Realtime payloads; BB broadcasts to every window, so each names its threads. */
export type SnapshotMessage = { threadIds: string[]; snapshot: Snapshot };
export type OpMessage = { threadIds: string[]; op: OpState };
