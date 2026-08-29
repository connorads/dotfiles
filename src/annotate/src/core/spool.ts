// Questions about the spool that have answers without touching tmux: which
// excerpt a `drop` names, and which pane a `send` should go to.

import type { Excerpt } from "./excerpt.ts";
import type { DropCommand } from "./args.ts";
import { err, ok, type Result } from "./result.ts";

/** The ids a `drop` resolves to, or why it resolves to none. */
export const dropTargets = (
  spool: readonly Excerpt[],
  target: DropCommand["target"],
): Result<readonly string[], string> => {
  if (target.kind === "all") return ok(spool.map((e) => e.id));
  if (spool.length === 0) return err("nothing stashed");
  if (target.kind === "last") return ok([(spool[spool.length - 1] as Excerpt).id]);
  const excerpt = spool[target.index - 1];
  if (excerpt === undefined) {
    return err(`no excerpt ${target.index} (spool holds ${spool.length})`);
  }
  return ok([excerpt.id]);
};

/** How a send target was arrived at, so the caller can say so. */
export type TargetChoice =
  | { readonly kind: "explicit"; readonly pane: string }
  /** Every excerpt came from the same pane. */
  | { readonly kind: "unanimous"; readonly pane: string }
  /** Excerpts came from several panes; the newest one wins, with a warning. */
  | { readonly kind: "mostRecent"; readonly pane: string; readonly panes: readonly string[] }
  | { readonly kind: "none" };

/**
 * Which pane a draft should be delivered to: `--to` wins, else the single
 * distinct pane among the spool's origins, else the most recent with a
 * warning. Explicit beats inferred so a re-send after `undo` can be aimed
 * somewhere the excerpts never came from.
 */
export const resolveTarget = (
  spool: readonly Excerpt[],
  explicit: string | null,
): TargetChoice => {
  if (explicit !== null) return { kind: "explicit", pane: explicit };
  const panes: string[] = [];
  for (const excerpt of spool) {
    if (excerpt.origin.kind === "unknown") continue;
    const pane = excerpt.origin.pane;
    if (pane !== null && !panes.includes(pane)) panes.push(pane);
  }
  const newest = panes[panes.length - 1];
  if (newest === undefined) return { kind: "none" };
  if (panes.length === 1) return { kind: "unanimous", pane: newest };
  return { kind: "mostRecent", pane: newest, panes };
};

/** JSON shape of `annotate list --json`, stable for scripting. */
export const spoolJson = (spool: readonly Excerpt[]): string =>
  JSON.stringify(
    spool.map((excerpt, i) => ({
      index: i + 1,
      id: excerpt.id,
      ts: excerpt.ts,
      origin: excerpt.origin,
      fingerprint: excerpt.fingerprint,
      text: excerpt.text,
    })),
    null,
    2,
  );
