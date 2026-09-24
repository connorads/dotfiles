// Git reads for target resolution, change collection and repo guidance.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { UNTRACKED_INLINE_MAX_BYTES, type Collected, type Untracked } from "../core/context.ts";
import type { GuidanceDoc } from "../core/prompt.ts";
import { err, ok, type Result } from "../core/result.ts";
import type { GitSnapshot } from "../core/target.ts";
import { run, tail } from "./proc.ts";

export const GUIDANCE_FILES = ["AGENTS.md", "CLAUDE.md", "REVIEW.md"] as const;

const git = async (cwd: string, args: readonly string[]): Promise<Result<string, string>> => {
  const r = await run(["git", ...args], { cwd });
  return r.code === 0 ? ok(r.stdout) : err(`git ${args.join(" ")}: ${tail(r.stderr) || `exit ${r.code}`}`);
};

const lines = (s: string): string[] => s.split("\n").filter((l) => l !== "");

export const repoRoot = async (cwd: string): Promise<Result<string, string>> => {
  const r = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return r.ok ? ok(r.value.trim()) : err("not inside a git repository");
};

export const snapshot = async (root: string): Promise<Result<GitSnapshot, string>> => {
  const status = await git(root, ["status", "--porcelain", "--untracked-files=all"]);
  if (!status.ok) return status;
  // An unset origin/HEAD makes --abbrev-ref answer with its own name.
  const head = await run(["git", "rev-parse", "--abbrev-ref", "origin/HEAD"], { cwd: root });
  const name = head.stdout.trim();
  const originHead = head.code === 0 && name !== "" && name !== "origin/HEAD" ? name : null;
  return ok({ dirty: status.value.trim() !== "", originHead });
};

export const revParse = async (root: string, ref: string): Promise<Result<string, string>> => {
  const r = await git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  return r.ok ? ok(r.value.trim()) : err(`unknown revision '${ref}'`);
};

export const mergeBase = async (root: string, a: string, b: string): Promise<Result<string, string>> => {
  const r = await git(root, ["merge-base", a, b]);
  return r.ok ? ok(r.value.trim()) : r;
};

const readUntracked = async (root: string, path: string): Promise<Untracked> => {
  const buf = await readFile(join(root, path)).catch(() => null);
  if (buf === null) return { path, size: 0, content: null };
  const binary = buf.includes(0);
  const content = binary || buf.length > UNTRACKED_INLINE_MAX_BYTES ? null : buf.toString("utf8");
  return { path, size: buf.length, content };
};

const DIFF = ["diff", "--no-ext-diff", "--no-color"] as const;

/** Tracked diff + untracked files of the working tree against HEAD. */
export const collectUncommitted = async (root: string): Promise<Result<Collected, string>> => {
  const diff = await git(root, [...DIFF, "HEAD"]);
  if (!diff.ok) return diff;
  const files = await git(root, [...DIFF, "--name-only", "HEAD"]);
  if (!files.ok) return files;
  const others = await git(root, ["ls-files", "--others", "--exclude-standard"]);
  if (!others.ok) return others;
  const untracked = await Promise.all(lines(others.value).map((p) => readUntracked(root, p)));
  return ok({ diff: diff.value, files: lines(files.value), untracked });
};

/** `from..to` as a diff. */
export const collectRange = async (root: string, from: string, to: string): Promise<Result<Collected, string>> => {
  const range = `${from}..${to}`;
  const diff = await git(root, [...DIFF, range]);
  if (!diff.ok) return diff;
  const files = await git(root, [...DIFF, "--name-only", range]);
  if (!files.ok) return files;
  return ok({ diff: diff.value, files: lines(files.value), untracked: [] });
};

export const collectCommit = async (root: string, sha: string): Promise<Result<Collected, string>> => {
  const show = await git(root, ["show", "--no-ext-diff", "--no-color", sha]);
  if (!show.ok) return show;
  const files = await git(root, ["show", "--name-only", "--format=", sha]);
  if (!files.ok) return files;
  return ok({ diff: show.value, files: lines(files.value), untracked: [] });
};

/** Keeps the first of any docs with identical text: CLAUDE.md is often a symlink to AGENTS.md. */
const dedupe = (docs: readonly GuidanceDoc[]): GuidanceDoc[] =>
  docs.filter((d, i) => docs.findIndex((o) => o.text === d.text) === i);

/** Guidance from the working tree. */
export const guidanceFromDisk = async (root: string): Promise<GuidanceDoc[]> => {
  const docs = await Promise.all(
    GUIDANCE_FILES.map(async (path): Promise<GuidanceDoc | null> => {
      const text = await readFile(join(root, path), "utf8").catch(() => null);
      return text === null ? null : { path, text };
    }),
  );
  return dedupe(docs.filter((d) => d !== null));
};

/**
 * Guidance as committed at `ref`. For a PR this is the base, so the PR cannot
 * rewrite the rules it is reviewed against. Symlink blobs are skipped: their
 * content is the link target's name, not its text.
 */
export const guidanceFromRef = async (root: string, ref: string): Promise<Result<GuidanceDoc[], string>> => {
  const tree = await git(root, ["ls-tree", ref, "--", ...GUIDANCE_FILES]);
  if (!tree.ok) return tree;
  const docs: GuidanceDoc[] = [];
  for (const entry of lines(tree.value)) {
    const m = /^(\d+) blob ([0-9a-f]+)\t(.+)$/.exec(entry);
    if (!m || m[1] === "120000") continue;
    const blob = await git(root, ["cat-file", "blob", m[2] ?? ""]);
    if (!blob.ok) return blob;
    docs.push({ path: m[3] ?? "", text: blob.value });
  }
  return ok(dedupe(docs));
};

export const fetchRefs = async (root: string, refspecs: readonly string[]): Promise<Result<void, string>> => {
  const r = await git(root, ["fetch", "--quiet", "--no-tags", "origin", ...refspecs]);
  return r.ok ? ok(undefined) : r;
};

export const hasCommit = async (root: string, sha: string): Promise<boolean> =>
  (await run(["git", "cat-file", "-e", `${sha}^{commit}`], { cwd: root })).code === 0;

export const addDetachedWorktree = async (root: string, path: string, sha: string): Promise<Result<void, string>> => {
  const r = await git(root, ["worktree", "add", "--quiet", "--detach", path, sha]);
  return r.ok ? ok(undefined) : r;
};

/** --force: the worktree is critique's own scratch copy, never user work. */
export const removeWorktree = async (root: string, path: string): Promise<Result<void, string>> => {
  const r = await git(root, ["worktree", "remove", "--force", path]);
  return r.ok ? ok(undefined) : r;
};
