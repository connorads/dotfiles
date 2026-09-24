// argv -> Options. Pure; unknown flags are a usage error rather than ignored,
// so a typo cannot silently fall back to a default review.

import { err, ok, type Result } from "./result.ts";
import { REVIEWER_KINDS, type ReviewerKind } from "./types.ts";

export type TargetSpec =
  | { readonly kind: "auto" }
  | { readonly kind: "uncommitted" }
  /** base null = origin/HEAD. */
  | { readonly kind: "branch"; readonly base: string | null }
  | { readonly kind: "commit"; readonly sha: string };

export type Format = "json" | "md";

export interface Options {
  readonly target: TargetSpec;
  /** Null = the default reviewer for this caller. */
  readonly reviewers: readonly ReviewerKind[] | null;
  readonly rubric: string | null;
  readonly focus: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  /** Null = json when stdout is not a TTY, md when it is. */
  readonly format: Format | null;
}

export type Parsed = { readonly kind: "help" } | { readonly kind: "run"; readonly options: Options };

export const USAGE = `usage: critique [options]

Headless, read-only review of a change by another agent. Prints one Review
document (JSON, or markdown with --md).

  --target <t>     auto (default) | uncommitted | branch[:<base>] | commit:<sha>
                   auto: the working tree when dirty, else the branch vs origin/HEAD
  --reviewer <r>   codex | claude (default: the agent that is not the caller)
  --rubric <ref>   skl skill whose bundle is added as review criteria
  --focus <text>   area to weight heavily
  --model <m>      override the reviewer's pinned model
  --effort <e>     override the reviewer's pinned reasoning effort
  --json | --md    output format (default: --json unless stdout is a TTY)
  -h, --help

exit: 0 approve · 1 needs-attention · 2 usage · 3 every reviewer failed`;

const VALUE_FLAGS = ["--target", "--reviewer", "--rubric", "--focus", "--model", "--effort"] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];
const isValueFlag = (s: string): s is ValueFlag => (VALUE_FLAGS as readonly string[]).includes(s);

export const parseTarget = (raw: string): Result<TargetSpec, string> => {
  const colon = raw.indexOf(":");
  const head = colon === -1 ? raw : raw.slice(0, colon);
  const rest = colon === -1 ? null : raw.slice(colon + 1);
  switch (head) {
    case "auto":
    case "uncommitted":
      return rest === null ? ok({ kind: head }) : err(`--target ${head} takes no argument`);
    case "branch":
      if (rest === "") return err("--target branch: empty base");
      return ok({ kind: "branch", base: rest });
    case "commit":
      if (!rest) return err("--target commit needs a sha: commit:<sha>");
      return ok({ kind: "commit", sha: rest });
    default:
      return err(`unknown --target '${raw}'`);
  }
};

export const parseReviewers = (raw: string): Result<readonly ReviewerKind[], string> => {
  const kinds: ReviewerKind[] = [];
  for (const part of raw.split(",")) {
    const kind = REVIEWER_KINDS.find((k) => k === part);
    if (!kind) return err(`unknown reviewer '${part}' (codex | claude)`);
    if (kinds.includes(kind)) return err(`reviewer '${kind}' listed twice`);
    kinds.push(kind);
  }
  if (kinds.length > 1) return err("one reviewer at a time");
  return ok(kinds);
};

export const parseArgs = (argv: readonly string[]): Result<Parsed, string> => {
  const values = new Map<ValueFlag, string>();
  let format: Format | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "-h" || arg === "--help") return ok({ kind: "help" });
    if (arg === "--json" || arg === "--md") {
      const f: Format = arg === "--json" ? "json" : "md";
      if (format !== null && format !== f) return err("--json and --md are exclusive");
      format = f;
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (!isValueFlag(name)) return err(`unknown argument '${arg}'`);
    let value: string | undefined;
    if (eq !== -1) value = arg.slice(eq + 1);
    else value = argv[++i];
    if (value === undefined) return err(`${name} needs a value`);
    if (values.has(name)) return err(`${name} given twice`);
    values.set(name, value);
  }

  const target = parseTarget(values.get("--target") ?? "auto");
  if (!target.ok) return target;

  let reviewers: readonly ReviewerKind[] | null = null;
  const rawReviewers = values.get("--reviewer");
  if (rawReviewers !== undefined) {
    const parsed = parseReviewers(rawReviewers);
    if (!parsed.ok) return parsed;
    reviewers = parsed.value;
  }

  return ok({
    kind: "run",
    options: {
      target: target.value,
      reviewers,
      rubric: values.get("--rubric") ?? null,
      focus: values.get("--focus") ?? null,
      model: values.get("--model") ?? null,
      effort: values.get("--effort") ?? null,
      format,
    },
  });
};
