// The copy-mode selection.
//
// The text arrives on stdin, because `copy-pipe` hands the selection to the
// child that way. Provenance arrives on flags, because `copy-pipe` *does*
// format-expand its command string and `#{pane_id}` there resolves to the
// pane the selection was made in.
//
// That last point is worth stating, because both obvious alternatives are
// wrong. `$TMUX_PANE` is not set for a copy-pipe child - man tmux passes it to
// "the child process of the pane", and a copy-pipe child is spawned by the
// server - and in practice it leaks a stale value inherited from whatever
// started the server. Querying `display-message -p '#{pane_id}'` from inside
// the child resolves to the *active* pane, which is only incidentally the
// source pane. So the binding passes the id in, and this fills in the rest.

import { emptyOrigin } from "../../core/excerpt.ts";
import { ok, type Result } from "../../core/result.ts";
import { enrich } from "./enrich.ts";
import type { Capture, SourceError, SourceRequest } from "./index.ts";

export const openSelection = async (
  request: SourceRequest,
): Promise<Result<Capture, SourceError>> => {
  const origin = await enrich(emptyOrigin("selection"), request);
  return ok({ text: await request.readStdin(), origin });
};
