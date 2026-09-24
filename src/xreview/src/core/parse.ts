// Reviewer output -> ReviewerReport. The reviewers were given a schema, but a
// schema is a request to a model, not a guarantee, so the core checks it again
// before anything downstream trusts the shape.

import { err, ok, type Result } from "./result.ts";
import { SEVERITIES, type RawFinding, type ReviewerReport, type Severity, type Verdict } from "./types.ts";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isLine = (v: unknown): v is number | null => v === null || (Number.isInteger(v) && (v as number) >= 1);
const isSeverity = (v: unknown): v is Severity => SEVERITIES.some((s) => s === v);
const isVerdict = (v: unknown): v is Verdict => v === "approve" || v === "needs-attention";

const parseFinding = (v: unknown, i: number): Result<RawFinding, string> => {
  const at = `findings[${i}]`;
  if (!isObj(v)) return err(`${at}: not an object`);
  const { severity, title, body, recommendation, file, line_start, line_end, confidence } = v;
  if (!isSeverity(severity)) return err(`${at}.severity: ${JSON.stringify(severity)}`);
  if (!isStr(title) || title === "") return err(`${at}.title: missing`);
  if (!isStr(body)) return err(`${at}.body: missing`);
  if (!isStr(recommendation)) return err(`${at}.recommendation: missing`);
  if (!(file === null || isStr(file))) return err(`${at}.file: not a string or null`);
  if (!isLine(line_start)) return err(`${at}.line_start: ${JSON.stringify(line_start)}`);
  if (!isLine(line_end)) return err(`${at}.line_end: ${JSON.stringify(line_end)}`);
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
    return err(`${at}.confidence: ${JSON.stringify(confidence)}`);
  }
  return ok({
    severity,
    title,
    body,
    recommendation,
    file: file === "" ? null : file,
    line_start,
    line_end,
    confidence,
  });
};

export const parseReport = (v: unknown): Result<ReviewerReport, string> => {
  if (!isObj(v)) return err("report is not a JSON object");
  const { verdict, summary, findings, next_steps } = v;
  if (!isVerdict(verdict)) return err(`verdict: ${JSON.stringify(verdict)}`);
  if (!isStr(summary)) return err("summary: missing");
  if (!Array.isArray(findings)) return err("findings: not an array");
  if (!Array.isArray(next_steps) || !next_steps.every(isStr)) return err("next_steps: not a string array");
  const parsed: RawFinding[] = [];
  for (const [i, f] of findings.entries()) {
    const r = parseFinding(f, i);
    if (!r.ok) return r;
    parsed.push(r.value);
  }
  return ok({ verdict, summary, findings: parsed, next_steps });
};

export const parseReportText = (text: string): Result<ReviewerReport, string> => {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return err(`not JSON: ${(e as Error).message}`);
  }
  return parseReport(v);
};
