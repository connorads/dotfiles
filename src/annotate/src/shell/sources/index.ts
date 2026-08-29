// The Source port and its dispatcher.
//
// `cli.ts` calls `openSource` and never learns which adapter it got. Adding a
// source is adding a case here plus a file beside this one - nothing upstream
// changes shape.
//
// Every source produces text *verbatim* plus an Origin. Nothing is re-resolved
// at render time: what was on screen when the key was pressed is what gets
// sent, which is the whole reason a stale excerpt cannot paste a credential
// that landed after capture.

import type { Origin, SourceKind } from "../../core/excerpt.ts";
import type { Result } from "../../core/result.ts";
import { openPane } from "./pane.ts";
import { openSelection } from "./selection.ts";

/** What the CLI knows before a source runs. */
export interface SourceRequest {
  readonly kind: SourceKind;
  /** Whatever arrived on stdin, already read. */
  readonly stdin: string;
  readonly pane: string | null;
  readonly cwd: string | null;
  readonly session: string | null;
  readonly entry: string | null;
}

export interface Capture {
  readonly text: string;
  readonly origin: Origin;
}

export type SourceError =
  /** The named pane does not exist, or tmux cannot be reached. */
  | { readonly kind: "unresolvable"; readonly message: string }
  /** The source produced nothing. Benign - an empty selection is a misfire. */
  | { readonly kind: "empty" };

export type Source = (request: SourceRequest) => Promise<Result<Capture, SourceError>>;

export const openSource: Source = async (request) => {
  switch (request.kind) {
    case "selection":
      return openSelection(request);
    case "pane":
      return openPane(request);
    case "transcript":
      // Lands with the transcript source. Until then, saying so beats
      // silently stashing whatever happened to be on stdin.
      return {
        ok: false,
        error: { kind: "unresolvable", message: "the transcript source is not wired up yet" },
      };
  }
};
