import { expect, test } from "bun:test";
import { renderMarkdown } from "./render.ts";
import { assemble, exitCode } from "./review.ts";
import { DEFAULT_SPECS, type ReviewerReport } from "./types.ts";

const report: ReviewerReport = {
  verdict: "needs-attention",
  summary: "Do not ship.",
  findings: [
    {
      severity: "high",
      title: "Race",
      body: "b",
      recommendation: "lock it",
      file: "a.ts",
      line_start: 3,
      line_end: 5,
      confidence: 0.8,
    },
  ],
  next_steps: ["add a lock"],
};

test("a single reviewer's findings are tagged with it", () => {
  const r = assemble({ kind: "uncommitted" }, [{ ok: true, spec: DEFAULT_SPECS.codex, report }]);
  expect(r.findings[0]?.reviewers).toEqual(["codex"]);
  expect(r.verdict).toBe("needs-attention");
  expect(exitCode(r)).toBe(1);
});

test("approve exits 0", () => {
  const r = assemble({ kind: "uncommitted" }, [
    { ok: true, spec: DEFAULT_SPECS.claude, report: { ...report, verdict: "approve", findings: [] } },
  ]);
  expect(exitCode(r)).toBe(0);
});

test("a failed reviewer yields no verdict and exit 3", () => {
  const r = assemble({ kind: "commit", sha: "abc" }, [
    { ok: false, spec: DEFAULT_SPECS.codex, error: { reviewer: "codex", message: "boom" } },
  ]);
  expect(r.verdict).toBeNull();
  expect(r.errors).toEqual([{ reviewer: "codex", message: "boom" }]);
  expect(exitCode(r)).toBe(3);
});

test("markdown carries location, confidence and reviewer", () => {
  const md = renderMarkdown(assemble({ kind: "uncommitted" }, [{ ok: true, spec: DEFAULT_SPECS.codex, report }]));
  expect(md).toContain("# xreview: needs-attention");
  expect(md).toContain("### 1. [high] Race");
  expect(md).toContain("`a.ts:3-5` · confidence 0.8 · codex");
  expect(md).toContain("**Recommendation.** lock it");
});
