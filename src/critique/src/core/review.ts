// Reviewer outputs -> the one Review document, and the exit code it implies.

import { summariseTarget, type Review, type ReviewerOutput, type Target } from "./types.ts";

export const EXIT = { approve: 0, needsAttention: 1, usage: 2, failed: 3 } as const;

export const assemble = (target: Target, outputs: readonly ReviewerOutput[]): Review => {
  const reviewers = outputs.map((o) => o.spec);
  const errors = outputs.flatMap((o) => (o.ok ? [] : [o.error]));
  const [first] = outputs.flatMap((o) => (o.ok ? [o] : []));
  if (!first) {
    return {
      verdict: null,
      summary: "Every reviewer failed; there is no review.",
      findings: [],
      next_steps: [],
      target: summariseTarget(target),
      reviewers,
      errors,
    };
  }
  const { report, spec } = first;
  return {
    verdict: report.verdict,
    summary: report.summary,
    findings: report.findings.map((f) => ({ ...f, reviewers: [spec.kind] })),
    next_steps: report.next_steps,
    target: summariseTarget(target),
    reviewers,
    errors,
  };
};

export const exitCode = (review: Review): number => {
  switch (review.verdict) {
    case null:
      return EXIT.failed;
    case "approve":
      return EXIT.approve;
    case "needs-attention":
      return EXIT.needsAttention;
  }
};
