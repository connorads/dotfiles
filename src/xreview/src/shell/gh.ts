// GitHub: PR metadata in, a pending review out. Both through `gh`, run from
// the repo root so `{owner}/{repo}` resolve to its origin.

import type { ReviewPayload } from "../core/pr-comments.ts";
import { err, ok, type Result } from "../core/result.ts";
import { run, tail } from "./proc.ts";

export interface PrInfo {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly headRefOid: string;
  readonly baseRefName: string;
  readonly baseRefOid: string;
}

const isPrInfo = (v: unknown): v is PrInfo => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["number"] === "number" &&
    typeof o["title"] === "string" &&
    typeof o["body"] === "string" &&
    typeof o["headRefOid"] === "string" &&
    typeof o["baseRefName"] === "string" &&
    typeof o["baseRefOid"] === "string"
  );
};

export const prView = async (root: string, n: number): Promise<Result<PrInfo, string>> => {
  const r = await run(
    ["gh", "pr", "view", String(n), "--json", "number,title,body,headRefOid,baseRefName,baseRefOid"],
    { cwd: root },
  );
  if (r.code !== 0) return err(`gh pr view ${n}: ${tail(r.stderr) || `exit ${r.code}`}`);
  let v: unknown;
  try {
    v = JSON.parse(r.stdout);
  } catch {
    return err(`gh pr view ${n}: not JSON`);
  }
  return isPrInfo(v) ? ok(v) : err(`gh pr view ${n}: unexpected shape`);
};

/** Creates the review PENDING (no `event`); returns its URL. */
export const postPendingReview = async (
  root: string,
  n: number,
  payload: ReviewPayload,
): Promise<Result<string, string>> => {
  const r = await run(
    ["gh", "api", "--method", "POST", `repos/{owner}/{repo}/pulls/${n}/reviews`, "--input", "-"],
    { cwd: root, stdin: JSON.stringify(payload) },
  );
  if (r.code !== 0) return err(`gh api pulls/${n}/reviews: ${tail(r.stderr) || tail(r.stdout)}`);
  try {
    const out = JSON.parse(r.stdout) as { html_url?: unknown; state?: unknown };
    if (out.state !== "PENDING") return err(`review created in state ${String(out.state)}, expected PENDING`);
    return ok(typeof out.html_url === "string" ? out.html_url : "(no url)");
  } catch {
    return err("gh api: response is not JSON");
  }
};
