// Reviewer outputs -> the one Review document, and the exit code it implies.

import { mergeFindings, mergeNextSteps, mergeSummary, mergeVerdict, type Tagged } from "./panel.ts";
import { summariseTarget, type Review, type ReviewerOutput, type Target } from "./types.ts";

export const EXIT = { approve: 0, needsAttention: 1, usage: 2, failed: 3 } as const;

export const assemble = (target: Target, outputs: readonly ReviewerOutput[]): Review => {
  const reviewers = outputs.map((o) => o.spec);
  const errors = outputs.flatMap((o) => (o.ok ? [] : [o.error]));
  const tagged: Tagged[] = outputs.flatMap((o) => (o.ok ? [{ reviewer: o.spec.kind, report: o.report }] : []));
  if (tagged.length === 0) {
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
  return {
    verdict: mergeVerdict(tagged),
    summary: mergeSummary(tagged),
    findings: mergeFindings(tagged),
    next_steps: mergeNextSteps(tagged),
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
