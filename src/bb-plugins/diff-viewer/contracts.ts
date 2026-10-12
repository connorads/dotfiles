import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

const sha = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/);

/** What the panel compares. Unpushed narrows to one commit when `commit` is set. */
export const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uncommitted') }),
  z.object({ kind: z.literal('unpushed'), commit: sha.nullable() }),
  z.object({ kind: z.literal('branch') }),
]);
export type Scope = z.infer<typeof scopeSchema>;
export type ScopeKind = Scope['kind'];

/** A resolved comparison: tree-ish `from` against commit `to`, or against the work tree when `to` is null. */
export const specSchema = z.object({ from: sha, to: sha.nullable(), untracked: z.boolean() });
export type Spec = z.infer<typeof specSchema>;

export const bodySchema = z.discriminatedUnion('kind', [
  /** `shownLines < totalLines` means the patch was cut; fetch the file for the rest. */
  z.object({ kind: z.literal('patch'), patch: z.string(), shownLines: z.number(), totalLines: z.number() }),
  z.object({ kind: z.literal('binary') }),
  /** A pure rename, copy or mode change: nothing to show line by line. */
  z.object({ kind: z.literal('empty') }),
  z.object({ kind: z.literal('deferred'), reason: z.enum(['lockfile', 'large', 'budget']) }),
]);
export type Body = z.infer<typeof bodySchema>;

export const fileSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: z.enum(['added', 'deleted', 'modified', 'renamed', 'copied']),
  /** Null when unknown: binary, or an untracked file whose patch is not loaded. */
  additions: z.number().nullable(),
  deletions: z.number().nullable(),
  untracked: z.boolean(),
  lockfile: z.boolean(),
  modeChange: z.string().nullable(),
  body: bodySchema,
});
export type FileDiff = z.infer<typeof fileSchema>;

export const commitSchema = z.object({ sha, shortSha: z.string(), subject: z.string(), time: z.number() });
export type Commit = z.infer<typeof commitSchema>;

export const viewSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    spec: specSchema,
    /** What the diff is against, for the header: `HEAD`, `origin/main..HEAD`, `main...work tree`. */
    label: z.string(),
    /** Unpushed only: the cumulative range's commits, newest first. */
    commits: z.array(commitSchema).nullable(),
    note: z.string().nullable(),
    files: z.array(fileSchema),
    /** Changed files past the display cap, which the list omits. */
    hidden: z.number(),
  }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type View = z.infer<typeof viewSchema>;

export const loadResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.enum(['repo', 'dotfiles']), name: z.string(), branch: z.string().nullable(), view: viewSchema }),
]);
export type LoadResult = z.infer<typeof loadResultSchema>;

const root = z.string().min(1);
const fileInput = { spec: specSchema, path: z.string().min(1), oldPath: z.string().nullable(), untracked: z.boolean() };

export const hostContract = defineRpcContract({
  load: { input: z.object({ root, scope: scopeSchema }), output: loadResultSchema },
  /** One file's whole patch (to the expanded cap), for "show all" and deferred files. */
  file: { input: z.object({ root, ...fileInput }), output: bodySchema },
});

const thread = { threadId: z.string().min(1) };
export const rpcContract = defineRpcContract({
  load: { input: z.object({ ...thread, scope: scopeSchema }), output: loadResultSchema },
  file: { input: z.object({ ...thread, ...fileInput }), output: bodySchema },
});
