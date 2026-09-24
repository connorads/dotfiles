// Review -> markdown, for a human at a terminal (--md).

import type { Finding, Review, ReviewerSpec, TargetSummary } from "./types.ts";

const targetText = (t: TargetSummary): string => {
  switch (t.kind) {
    case "uncommitted":
      return "uncommitted changes";
    case "branch":
      return `branch vs ${t.base}`;
    case "commit":
      return `commit ${t.sha.slice(0, 12)}`;
    case "pr":
      return `PR #${t.number}`;
    case "plan":
      return `plan ${t.source}`;
  }
};

const specText = (s: ReviewerSpec): string => `${s.kind} (${s.model}, ${s.effort})`;

export const location = (f: Finding): string | null => {
  if (f.file === null) return null;
  if (f.line_start === null) return f.file;
  const end = f.line_end !== null && f.line_end !== f.line_start ? `-${f.line_end}` : "";
  return `${f.file}:${f.line_start}${end}`;
};

const findingText = (f: Finding, i: number): string => {
  const loc = location(f);
  const meta = [loc === null ? null : `\`${loc}\``, `confidence ${f.confidence}`, f.reviewers.join(" + ")]
    .filter((s) => s !== null)
    .join(" · ");
  const rec = f.recommendation.trim() === "" ? [] : ["", `**Recommendation.** ${f.recommendation}`];
  return [`### ${i + 1}. [${f.severity}] ${f.title}`, "", meta, "", f.body, ...rec].join("\n");
};

export const renderMarkdown = (r: Review): string => {
  const out = [
    `# critique: ${r.verdict ?? "failed"}`,
    "",
    r.summary,
    "",
    `Target: ${targetText(r.target)} · Reviewers: ${r.reviewers.map(specText).join(", ")}`,
  ];
  if (r.findings.length > 0) {
    out.push("", `## Findings (${r.findings.length})`);
    r.findings.forEach((f, i) => out.push("", findingText(f, i)));
  }
  if (r.next_steps.length > 0) out.push("", "## Next steps", "", ...r.next_steps.map((s) => `- ${s}`));
  if (r.errors.length > 0) out.push("", "## Errors", "", ...r.errors.map((e) => `- ${e.reviewer}: ${e.message}`));
  return `${out.join("\n")}\n`;
};
