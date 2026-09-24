// Which local change to review, decided from a git snapshot. The rule follows
// codex-plugin-cc: a dirty tree (staged, unstaged or untracked) is the change;
// a clean one means the branch against its merge-base with origin/HEAD. The
// base is never assumed to be `main`.

import type { TargetSpec } from "./args.ts";
import { err, ok, type Result } from "./result.ts";

export interface GitSnapshot {
  /** Any staged, unstaged or untracked change. */
  readonly dirty: boolean;
  /** e.g. origin/master; null when origin/HEAD is unset. */
  readonly originHead: string | null;
}

export type LocalTarget =
  | { readonly kind: "uncommitted" }
  | { readonly kind: "branch"; readonly base: string }
  | { readonly kind: "commit"; readonly sha: string };

export const NO_ORIGIN_HEAD =
  "origin/HEAD is unset, so there is no base branch to review against; run `git remote set-head origin -a` or pass --target branch:<base>";

export const resolveLocal = (
  spec: Exclude<TargetSpec, { kind: "pr" } | { kind: "plan" }>,
  snap: GitSnapshot,
): Result<LocalTarget, string> => {
  switch (spec.kind) {
    case "uncommitted":
      return ok({ kind: "uncommitted" });
    case "commit":
      return ok({ kind: "commit", sha: spec.sha });
    case "branch": {
      const base = spec.base ?? snap.originHead;
      return base === null ? err(NO_ORIGIN_HEAD) : ok({ kind: "branch", base });
    }
    case "auto":
      if (snap.dirty) return ok({ kind: "uncommitted" });
      return snap.originHead === null ? err(NO_ORIGIN_HEAD) : ok({ kind: "branch", base: snap.originHead });
  }
};
