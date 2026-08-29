// A pane snapshot.
//
// The text arrives on stdin, like every other source:
//
//   tmux capture-pane -p -t %12 | annotate stash --source pane --pane %12
//
// So this adapter does no capturing of its own - it only fills in the Origin
// fields the caller did not supply. A source that needs no logic is a pipe;
// only sources with real work get an adapter that produces text.
//
// Snapshotting here instead was tried and removed. It made `--pane` with no
// pipe mean "capture from tmux", which left `stash` with no deterministic rule
// for when to read stdin - and reading stdin that is neither a TTY nor ever
// closed blocks forever.
//
// A Claude pane runs on the alternate screen, so tmux holds no conversation
// scrollback for it and any snapshot reaches exactly one screenful. That is a
// property of the surface, not of this adapter - the transcript source is the
// answer to it.

import { emptyOrigin } from "../../core/excerpt.ts";
import { ok, type Result } from "../../core/result.ts";
import { enrich } from "./enrich.ts";
import type { Capture, SourceError, SourceRequest } from "./index.ts";

export const openPane = async (request: SourceRequest): Promise<Result<Capture, SourceError>> => {
  const origin = await enrich(emptyOrigin("pane"), request);
  return ok({ text: await request.readStdin(), origin });
};
