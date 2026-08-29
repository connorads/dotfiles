// Filling in the Origin fields the caller did not supply.
//
// Flags always win: a binding that already knows the pane must not have that
// answer second-guessed. Everything else - session, cwd, agent kind and name -
// is asked of tmux once, and left null when tmux cannot say.

import type { Origin } from "../../core/excerpt.ts";
import { paneInfo } from "../tmux.ts";
import type { SourceRequest } from "./index.ts";

export const enrich = async (base: Origin, request: SourceRequest): Promise<Origin> => {
  const pane = request.pane;
  const flagged: Origin = {
    ...base,
    pane,
    cwd: request.cwd,
    session: request.session,
    entryId: request.entry,
  };
  if (pane === null) return flagged;

  const info = await paneInfo(pane);
  // A pane that cannot be described is not an error here. Provenance is
  // enrichment; losing it must never cost the capture.
  if (info === null) return flagged;

  return {
    ...flagged,
    session: flagged.session ?? info.session,
    cwd: flagged.cwd ?? info.cwd,
    agentKind: info.agentKind,
    agentName: info.agentName,
  };
};
