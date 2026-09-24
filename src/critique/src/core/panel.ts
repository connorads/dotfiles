// Merge several reviewers' reports into one. Two findings are the same
// finding when different reviewers put them in the same file on overlapping
// lines; the merged one keeps the most severe wording, the widest range, the
// highest confidence and every reviewer that raised it. Findings without a
// line range (plan reviews, file-level remarks) are never merged: there is no
// location to agree on.

import {
  SEVERITIES,
  type Finding,
  type ReviewerKind,
  type ReviewerReport,
  type Verdict,
} from "./types.ts";

export interface Tagged {
  readonly reviewer: ReviewerKind;
  readonly report: ReviewerReport;
}

const rank = (f: Finding): number => SEVERITIES.indexOf(f.severity);

const overlaps = (a: Finding, b: Finding): boolean => {
  if (a.file === null || a.file !== b.file || a.line_start === null || b.line_start === null) return false;
  const aEnd = a.line_end ?? a.line_start;
  const bEnd = b.line_end ?? b.line_start;
  return a.line_start <= bEnd && b.line_start <= aEnd;
};

const combine = (a: Finding, b: Finding): Finding => {
  const lead = rank(b) < rank(a) ? b : a;
  const start = Math.min(a.line_start ?? Infinity, b.line_start ?? Infinity);
  const end = Math.max(a.line_end ?? a.line_start ?? 0, b.line_end ?? b.line_start ?? 0);
  return {
    ...lead,
    line_start: start,
    line_end: end,
    confidence: Math.max(a.confidence, b.confidence),
    reviewers: [...a.reviewers, ...b.reviewers.filter((r) => !a.reviewers.includes(r))],
  };
};

export const mergeFindings = (tagged: readonly Tagged[]): Finding[] => {
  const merged: Finding[] = [];
  for (const { reviewer, report } of tagged) {
    for (const raw of report.findings) {
      const f: Finding = { ...raw, reviewers: [reviewer] };
      const i = merged.findIndex((m) => !m.reviewers.includes(reviewer) && overlaps(m, f));
      if (i === -1) merged.push(f);
      else merged[i] = combine(merged[i] as Finding, f);
    }
  }
  return merged.sort((a, b) => rank(a) - rank(b) || b.reviewers.length - a.reviewers.length || b.confidence - a.confidence);
};

export const mergeVerdict = (tagged: readonly Tagged[]): Verdict =>
  tagged.some((t) => t.report.verdict === "needs-attention") ? "needs-attention" : "approve";

export const mergeSummary = (tagged: readonly Tagged[]): string =>
  tagged.length === 1 ? (tagged[0]?.report.summary ?? "") : tagged.map((t) => `${t.reviewer}: ${t.report.summary}`).join("\n");

export const mergeNextSteps = (tagged: readonly Tagged[]): string[] => [
  ...new Set(tagged.flatMap((t) => t.report.next_steps)),
];
