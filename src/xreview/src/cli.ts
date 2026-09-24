// critique: headless, read-only review of a change by another agent.
// Composition root: parse, resolve the target, collect the change, build the
// prompt, run the reviewer, print one Review document, exit on its verdict.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs, USAGE, type Options } from "./core/args.ts";
import { defaultReviewer } from "./core/caller.ts";
import { isEmpty, renderContext, renderPlan, targetLabel, type Collected } from "./core/context.ts";
import { parseReport } from "./core/parse.ts";
import { reviewPayload } from "./core/pr-comments.ts";
import { buildPrompt, type GuidanceDoc } from "./core/prompt.ts";
import { renderMarkdown } from "./core/render.ts";
import { err, ok, type Result } from "./core/result.ts";
import { assemble, EXIT, exitCode } from "./core/review.ts";
import { resolveLocal } from "./core/target.ts";
import {
  DEFAULT_SPECS,
  type ReviewerKind,
  type ReviewerOutput,
  type ReviewerSpec,
  type Target,
} from "./core/types.ts";
import { runClaude } from "./shell/claude.ts";
import { runCodex } from "./shell/codex.ts";
import { readEnv, type Env } from "./shell/env.ts";
import { postPendingReview, prView } from "./shell/gh.ts";
import {
  addDetachedWorktree,
  collectCommit,
  collectRange,
  collectUncommitted,
  fetchRefs,
  guidanceFromDisk,
  guidanceFromRef,
  hasCommit,
  mergeBase,
  removeWorktree,
  repoRoot,
  revParse,
  snapshot,
} from "./shell/git.ts";
import type { RunReviewer } from "./shell/reviewer.ts";
import { inlineRubric } from "./shell/skl.ts";

const PROMPTS = join(import.meta.dir, "..", "prompts");

const RUNNERS: Readonly<Record<ReviewerKind, RunReviewer>> = { codex: runCodex, claude: runClaude };

/** A failure before any reviewer ran, and the exit code it maps to. */
interface Stop {
  readonly code: number;
  readonly message: string;
}

const usage = (message: string): Stop => ({ code: EXIT.usage, message });
const failed = (message: string): Stop => ({ code: EXIT.failed, message });

const specsFor = (options: Options, env: Env): ReviewerSpec[] => {
  const kinds = options.reviewers ?? [defaultReviewer(env.caller)];
  return kinds.map((kind) => ({
    ...DEFAULT_SPECS[kind],
    ...(options.model === null ? {} : { model: options.model }),
    ...(options.effort === null ? {} : { effort: options.effort }),
  }));
};

interface Prepared {
  readonly target: Target;
  /** Where the reviewer runs: the repo root, or a PR's worktree. */
  readonly cwd: string;
  readonly template: "review.md" | "plan.md";
  /** The rendered change; null when there is nothing to review. */
  readonly context: string | null;
  /** The tracked diff, for mapping findings onto PR lines. */
  readonly diff: string;
  readonly guidance: readonly GuidanceDoc[];
  /** Paths the reviewer must not write. */
  readonly denyWrite: readonly string[];
  /** Undo whatever preparing created. Always safe to call. */
  readonly cleanup: () => Promise<void>;
}

const noCleanup = async (): Promise<void> => {};

const change = (target: Target, collected: Collected) => ({
  template: "review.md" as const,
  context: isEmpty(collected) ? null : renderContext(target, collected),
  diff: collected.diff,
});

const readPlan = async (path: string, cwd: string): Promise<Result<string, string>> => {
  try {
    return ok(path === "-" ? await Bun.stdin.text() : await readFile(resolve(cwd, path), "utf8"));
  } catch (e) {
    return err(`cannot read plan ${path}: ${(e as Error).message}`);
  }
};

/**
 * A plan needs no git, but inside a repository the reviewer runs at its root
 * so it can check the plan's claims against the code.
 */
const preparePlan = async (path: string, cwd: string): Promise<Result<Prepared, Stop>> => {
  const text = await readPlan(path, cwd);
  if (!text.ok) return err(usage(text.error));
  const source = path === "-" ? "stdin" : path;
  const root = await repoRoot(cwd);
  const dir = root.ok ? root.value : cwd;
  return ok({
    target: { kind: "plan", text: text.value, source },
    cwd: dir,
    template: "plan.md",
    context: text.value.trim() === "" ? null : renderPlan(text.value, source),
    diff: "",
    guidance: root.ok ? await guidanceFromDisk(dir) : [],
    denyWrite: [dir],
    cleanup: noCleanup,
  });
};

const preparePr = async (n: number, root: string, env: Env): Promise<Result<Prepared, Stop>> => {
  const info = await prView(root, n);
  if (!info.ok) return err(failed(info.error));
  const pr = info.value;
  const fetched = await fetchRefs(root, [`pull/${n}/head`, `refs/heads/${pr.baseRefName}`]);
  if (!fetched.ok) return err(failed(fetched.error));
  for (const sha of [pr.headRefOid, pr.baseRefOid]) {
    if (!(await hasCommit(root, sha))) return err(failed(`PR #${n}: ${sha} not fetched; the PR moved, retry`));
  }
  const mb = await mergeBase(root, pr.baseRefOid, pr.headRefOid);
  if (!mb.ok) return err(failed(mb.error));
  const guidance = await guidanceFromRef(root, pr.baseRefOid);
  if (!guidance.ok) return err(failed(guidance.error));

  const scratch = await mkdtemp(join(env.tmpdir, `critique-pr${n}-`));
  const worktree = join(scratch, "wt");
  const cleanup = async (): Promise<void> => {
    const removed = await removeWorktree(root, worktree);
    if (!removed.ok) console.error(`critique: could not remove ${worktree}: ${removed.error}`);
    await rm(scratch, { recursive: true, force: true });
  };
  const added = await addDetachedWorktree(root, worktree, pr.headRefOid);
  if (!added.ok) {
    await rm(scratch, { recursive: true, force: true });
    return err(failed(added.error));
  }
  const collected = await collectRange(worktree, mb.value, pr.headRefOid);
  if (!collected.ok) {
    await cleanup();
    return err(failed(collected.error));
  }
  const target: Target = {
    kind: "pr",
    number: n,
    title: pr.title,
    body: pr.body,
    headSha: pr.headRefOid,
    baseSha: pr.baseRefOid,
    mergeBase: mb.value,
    worktree,
  };
  return ok({
    target,
    cwd: worktree,
    ...change(target, collected.value),
    guidance: guidance.value,
    denyWrite: [worktree, root],
    cleanup,
  });
};

const prepare = async (options: Options, cwd: string, env: Env): Promise<Result<Prepared, Stop>> => {
  const spec = options.target;
  if (spec.kind === "plan") return preparePlan(spec.path, cwd);
  const found = await repoRoot(cwd);
  if (!found.ok) return err(usage(found.error));
  const root = found.value;
  if (spec.kind === "pr") return preparePr(spec.number, root, env);

  const snap = await snapshot(root);
  if (!snap.ok) return err(failed(snap.error));
  const local = resolveLocal(spec, snap.value);
  if (!local.ok) return err(usage(local.error));

  let target: Target;
  let collected: Result<Collected, string>;
  switch (local.value.kind) {
    case "uncommitted":
      target = { kind: "uncommitted" };
      collected = await collectUncommitted(root);
      break;
    case "branch": {
      const base = local.value.base;
      const baseSha = await revParse(root, base);
      if (!baseSha.ok) return err(usage(baseSha.error));
      const mb = await mergeBase(root, baseSha.value, "HEAD");
      if (!mb.ok) return err(failed(mb.error));
      target = { kind: "branch", base, mergeBase: mb.value };
      collected = await collectRange(root, mb.value, "HEAD");
      break;
    }
    case "commit": {
      const sha = await revParse(root, local.value.sha);
      if (!sha.ok) return err(usage(sha.error));
      target = { kind: "commit", sha: sha.value };
      collected = await collectCommit(root, sha.value);
      break;
    }
  }
  if (!collected.ok) return err(failed(collected.error));
  return ok({
    target,
    cwd: root,
    ...change(target, collected.value),
    guidance: await guidanceFromDisk(root),
    denyWrite: [root],
    cleanup: noCleanup,
  });
};

interface RunContext {
  readonly prompt: string;
  readonly cwd: string;
  readonly workroot: string;
  readonly home: string;
  readonly denyWrite: readonly string[];
}

const runOne = async (spec: ReviewerSpec, ctx: RunContext): Promise<ReviewerOutput> => {
  const workdir = join(ctx.workroot, spec.kind);
  await Bun.write(join(workdir, ".keep"), "");
  const raw = await RUNNERS[spec.kind]({ ...ctx, spec, workdir });
  if (!raw.ok) return { ok: false, spec, error: { reviewer: spec.kind, message: raw.error } };
  const report = parseReport(raw.value);
  if (!report.ok) {
    return { ok: false, spec, error: { reviewer: spec.kind, message: `malformed report: ${report.error}` } };
  }
  return { ok: true, spec, report: report.value };
};

export const main = async (argv: readonly string[], env: Env, cwd: string): Promise<number> => {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    console.error(`critique: ${parsed.error}\n\n${USAGE}`);
    return EXIT.usage;
  }
  if (parsed.value.kind === "help") {
    console.log(USAGE);
    return 0;
  }
  const options = parsed.value.options;
  const specs = specsFor(options, env);

  let rubric: string | null = null;
  if (options.rubric !== null) {
    const r = await inlineRubric(options.rubric);
    if (!r.ok) {
      console.error(`critique: ${r.error}`);
      return EXIT.usage;
    }
    rubric = r.value;
  }

  const prepared = await prepare(options, cwd, env);
  if (!prepared.ok) {
    console.error(`critique: ${prepared.error.message}`);
    return prepared.error.code;
  }
  // A caller that times a background review out sends SIGTERM; the PR
  // worktree must not outlive the run either way.
  const onSignal = (signal: NodeJS.Signals): void => {
    void prepared.value.cleanup().then(() => process.exit(signal === "SIGINT" ? 130 : 143));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return await review(options, specs, prepared.value, rubric, env);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await prepared.value.cleanup();
  }
};

const review = async (
  options: Options,
  specs: readonly ReviewerSpec[],
  prepared: Prepared,
  rubric: string | null,
  env: Env,
): Promise<number> => {
  const { target, context } = prepared;
  if (context === null) {
    console.error(`critique: nothing to review in ${targetLabel(target)}`);
    return EXIT.usage;
  }

  const template = await readFile(join(PROMPTS, prepared.template), "utf8");
  const prompt = buildPrompt(template, {
    guidance: prepared.guidance,
    rubric,
    focus: options.focus,
    context,
  });
  if (!prompt.ok) {
    console.error(`critique: ${prompt.error}`);
    return EXIT.failed;
  }

  const workroot = await mkdtemp(join(env.tmpdir, "critique-"));
  let outputs: ReviewerOutput[];
  try {
    const who = specs.map((s) => `${s.kind} (${s.model}, ${s.effort})`).join(", ");
    console.error(`critique: reviewing ${targetLabel(target)} with ${who}`);
    const ctx: RunContext = {
      prompt: prompt.value,
      cwd: prepared.cwd,
      workroot,
      home: env.home,
      denyWrite: prepared.denyWrite,
    };
    outputs = await Promise.all(specs.map((s) => runOne(s, ctx)));
  } finally {
    await rm(workroot, { recursive: true, force: true });
  }

  const result = assemble(target, outputs);
  const format = options.format ?? (process.stdout.isTTY ? "md" : "json");
  process.stdout.write(format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result));

  if (options.post && target.kind === "pr" && result.verdict !== null) {
    const posted = await postPendingReview(
      prepared.cwd,
      target.number,
      reviewPayload(result, target.headSha, prepared.diff),
    );
    if (!posted.ok) {
      console.error(`critique: --post failed: ${posted.error}`);
      return EXIT.failed;
    }
    console.error(`critique: pending review created (submit it yourself): ${posted.value}`);
  }
  return exitCode(result);
};

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2), readEnv(), process.cwd()));
}
