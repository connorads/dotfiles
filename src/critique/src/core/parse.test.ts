import { expect, test } from "bun:test";
import { parseReport, parseReportText } from "./parse.ts";

const finding = {
  severity: "high",
  title: "t",
  body: "b",
  recommendation: "r",
  file: "a.ts",
  line_start: 3,
  line_end: 4,
  confidence: 0.7,
} as const;
const report = { verdict: "needs-attention", summary: "s", findings: [finding], next_steps: ["x"] } as const;

test("a well-formed report parses", () => {
  expect(parseReport(report)).toEqual({ ok: true, value: report });
});

test("a plan finding may have no location", () => {
  const f = { ...finding, file: null, line_start: null, line_end: null };
  expect(parseReport({ ...report, findings: [f] }).ok).toBe(true);
});

test.each([
  ["verdict", { ...report, verdict: "ship" }],
  ["summary", { ...report, summary: 1 }],
  ["findings", { ...report, findings: {} }],
  ["next_steps", { ...report, next_steps: [1] }],
  ["severity", { ...report, findings: [{ ...finding, severity: "blocker" }] }],
  ["confidence", { ...report, findings: [{ ...finding, confidence: 1.5 }] }],
  ["line_start", { ...report, findings: [{ ...finding, line_start: 0 }] }],
  ["line_end", { ...report, findings: [{ ...finding, line_end: "4" }] }],
  ["file", { ...report, findings: [{ ...finding, file: 3 }] }],
  ["title", { ...report, findings: [{ ...finding, title: "" }] }],
])("rejects a bad %s", (field, bad) => {
  const r = parseReport(bad);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain(field);
});

test("rejects text that is not JSON", () => {
  expect(parseReportText("VERDICT: ship").ok).toBe(false);
  expect(parseReportText("[]").ok).toBe(false);
});
