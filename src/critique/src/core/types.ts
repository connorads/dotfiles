// Domain vocabulary shared by the core and the shell. See CONTEXT.md.

export type ReviewerKind = "claude" | "codex";

export const REVIEWER_KINDS: readonly ReviewerKind[] = ["claude", "codex"];

export interface ReviewerSpec {
  readonly kind: ReviewerKind;
  readonly model: string;
  readonly effort: string;
}

/** Pinned per reviewer; `--model` / `--effort` override. */
export const DEFAULT_SPECS: Readonly<Record<ReviewerKind, ReviewerSpec>> = {
  codex: { kind: "codex", model: "gpt-5.5", effort: "high" },
  claude: { kind: "claude", model: "opus", effort: "high" },
};

export type Target =
  | { readonly kind: "uncommitted" }
  | { readonly kind: "branch"; readonly base: string; readonly mergeBase: string }
  | { readonly kind: "commit"; readonly sha: string }
  | {
      readonly kind: "pr";
      readonly number: number;
      readonly title: string;
      /** The PR description: author-written, so untrusted like the diff. */
      readonly body: string;
      readonly headSha: string;
      readonly baseSha: string;
      readonly mergeBase: string;
      /** Detached worktree at headSha; removed after the run. */
      readonly worktree: string;
    }
  | { readonly kind: "plan"; readonly text: string; readonly source: string };

export type Severity = "critical" | "high" | "medium" | "low";

export const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"];

export type Verdict = "approve" | "needs-attention";

/** One finding as a reviewer emits it. */
export interface RawFinding {
  readonly severity: Severity;
  readonly title: string;
  readonly body: string;
  readonly recommendation: string;
  /** Null when the finding has no location, e.g. in a plan review. */
  readonly file: string | null;
  readonly line_start: number | null;
  readonly line_end: number | null;
  readonly confidence: number;
}

export interface Finding extends RawFinding {
  readonly reviewers: readonly ReviewerKind[];
}

/** A reviewer's parsed answer. */
export interface ReviewerReport {
  readonly verdict: Verdict;
  readonly summary: string;
  readonly findings: readonly RawFinding[];
  readonly next_steps: readonly string[];
}

export interface ReviewerError {
  readonly reviewer: ReviewerKind;
  readonly message: string;
}

export type ReviewerOutput =
  | { readonly ok: true; readonly spec: ReviewerSpec; readonly report: ReviewerReport }
  | { readonly ok: false; readonly spec: ReviewerSpec; readonly error: ReviewerError };

/** The serialisable description of a target in the output document. */
export type TargetSummary =
  | { readonly kind: "uncommitted" }
  | { readonly kind: "branch"; readonly base: string; readonly merge_base: string }
  | { readonly kind: "commit"; readonly sha: string }
  | { readonly kind: "pr"; readonly number: number; readonly head_sha: string }
  | { readonly kind: "plan"; readonly source: string };

/** The one document critique prints. */
export interface Review {
  /** Null only when every reviewer failed: there is no verdict to report. */
  readonly verdict: Verdict | null;
  readonly summary: string;
  readonly findings: readonly Finding[];
  readonly next_steps: readonly string[];
  readonly target: TargetSummary;
  readonly reviewers: readonly ReviewerSpec[];
  readonly errors: readonly ReviewerError[];
}

export const summariseTarget = (target: Target): TargetSummary => {
  switch (target.kind) {
    case "uncommitted":
      return { kind: "uncommitted" };
    case "branch":
      return { kind: "branch", base: target.base, merge_base: target.mergeBase };
    case "commit":
      return { kind: "commit", sha: target.sha };
    case "pr":
      return { kind: "pr", number: target.number, head_sha: target.headSha };
    case "plan":
      return { kind: "plan", source: target.source };
  }
};
