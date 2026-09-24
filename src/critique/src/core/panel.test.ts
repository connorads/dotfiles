import { expect, test } from "bun:test";
import { mergeFindings, mergeVerdict } from "./panel.ts";
import { assemble, exitCode } from "./review.ts";
import { DEFAULT_SPECS, type RawFinding, type ReviewerReport } from "./types.ts";

const f = (over: Partial<RawFinding>): RawFinding => ({
  severity: "medium",
  title: "t",
  body: "b",
  recommendation: "r",
  file: "a.ts",
  line_start: 10,
  line_end: 12,
  confidence: 0.5,
  ...over,
});
const report = (findings: RawFinding[], verdict: ReviewerReport["verdict"] = "needs-attention"): ReviewerReport => ({
  verdict,
  summary: "s",
  findings,
  next_steps: [],
});

test("overlapping findings from different reviewers merge, keeping the most severe", () => {
  const merged = mergeFindings([
    { reviewer: "codex", report: report([f({ title: "codex says", line_start: 10, line_end: 12, confidence: 0.9 })]) },
    { reviewer: "claude", report: report([f({ title: "claude says", severity: "high", line_start: 12, line_end: 20 })]) },
  ]);
  expect(merged).toEqual([
    {
      ...f({ title: "claude says", severity: "high", line_start: 10, line_end: 20, confidence: 0.9 }),
      reviewers: ["codex", "claude"],
    },
  ]);
});

test("disjoint lines, other files and unlocated findings stay separate", () => {
  const merged = mergeFindings([
    { reviewer: "codex", report: report([f({ line_start: 1, line_end: 2 }), f({ file: null, line_start: null, line_end: null })]) },
    { reviewer: "claude", report: report([f({ line_start: 3, line_end: 4 }), f({ file: "b.ts" }), f({ file: null, line_start: null, line_end: null })]) },
  ]);
  expect(merged).toHaveLength(5);
});

test("one reviewer's own overlapping findings are distinct issues", () => {
  expect(mergeFindings([{ reviewer: "codex", report: report([f({ title: "x" }), f({ title: "y" })]) }])).toHaveLength(2);
});

test("findings sort by severity, then agreement", () => {
  const merged = mergeFindings([
    { reviewer: "codex", report: report([f({ severity: "low", file: "z" }), f({ file: "a" })]) },
    { reviewer: "claude", report: report([f({ file: "a" }), f({ severity: "critical", file: "c" })]) },
  ]);
  expect(merged.map((m) => [m.severity, m.reviewers.length])).toEqual([
    ["critical", 1],
    ["medium", 2],
    ["low", 1],
  ]);
});

test("needs-attention from any reviewer wins", () => {
  expect(mergeVerdict([
    { reviewer: "codex", report: report([], "approve") },
    { reviewer: "claude", report: report([], "needs-attention") },
  ])).toBe("needs-attention");
});

test("a panel with one failure still reports, with the error listed", () => {
  const r = assemble({ kind: "uncommitted" }, [
    { ok: true, spec: DEFAULT_SPECS.codex, report: report([], "approve") },
    { ok: false, spec: DEFAULT_SPECS.claude, error: { reviewer: "claude", message: "timeout" } },
  ]);
  expect(r.verdict).toBe("approve");
  expect(r.errors).toEqual([{ reviewer: "claude", message: "timeout" }]);
  expect(r.reviewers.map((s) => s.kind)).toEqual(["codex", "claude"]);
  expect(exitCode(r)).toBe(0);
});

test("a panel where every reviewer failed exits 3", () => {
  const r = assemble({ kind: "uncommitted" }, [
    { ok: false, spec: DEFAULT_SPECS.codex, error: { reviewer: "codex", message: "a" } },
    { ok: false, spec: DEFAULT_SPECS.claude, error: { reviewer: "claude", message: "b" } },
  ]);
  expect(exitCode(r)).toBe(3);
});
