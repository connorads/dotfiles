// critique: headless, read-only review of a change by another agent.
// Composition root: parse, resolve the target, collect the change, build the
// prompt, run the reviewer, print one Review document, exit on its verdict.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs, USAGE, type Options } from "./core/args.ts";
import { defaultReviewer } from "./core/caller.ts";
import { isEmpty, renderContext, targetLabel, type Collected } from "./core/context.ts";
import { parseReport } from "./core/parse.ts";
import { buildPrompt } from "./core/prompt.ts";
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
import {
  collectCommit,
  collectRange,
  collectUncommitted,
  guidanceFromDisk,
  mergeBase,
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
  readonly cwd: string;
  readonly collected: Collected;
}

const prepareLocal = async (options: Options, root: string): Promise<Result<Prepared, Stop>> => {
  const snap = await snapshot(root);
  if (!snap.ok) return err(failed(snap.error));
  const local = resolveLocal(options.target, snap.value);
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
  return ok({ target, cwd: root, collected: collected.value });
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

  const root = await repoRoot(cwd);
  if (!root.ok) {
    console.error(`critique: ${root.error}`);
    return EXIT.usage;
  }

  const prepared = await prepareLocal(options, root.value);
  if (!prepared.ok) {
    console.error(`critique: ${prepared.error.message}`);
    return prepared.error.code;
  }
  const { target, collected } = prepared.value;
  if (isEmpty(collected)) {
    console.error(`critique: nothing to review in ${targetLabel(target)}`);
    return EXIT.usage;
  }

  let rubric: string | null = null;
  if (options.rubric !== null) {
    const r = await inlineRubric(options.rubric);
    if (!r.ok) {
      console.error(`critique: ${r.error}`);
      return EXIT.usage;
    }
    rubric = r.value;
  }

  const template = await readFile(join(PROMPTS, "review.md"), "utf8");
  const prompt = buildPrompt(template, {
    guidance: await guidanceFromDisk(root.value),
    rubric,
    focus: options.focus,
    context: renderContext(target, collected),
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
      cwd: prepared.value.cwd,
      workroot,
      home: env.home,
      denyWrite: [root.value],
    };
    outputs = await Promise.all(specs.map((s) => runOne(s, ctx)));
  } finally {
    await rm(workroot, { recursive: true, force: true });
  }

  const review = assemble(target, outputs);
  const format = options.format ?? (process.stdout.isTTY ? "md" : "json");
  process.stdout.write(format === "json" ? `${JSON.stringify(review, null, 2)}\n` : renderMarkdown(review));
  return exitCode(review);
};

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2), readEnv(), process.cwd()));
}
