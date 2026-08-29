// Ambient environment, read in one place so tests can override it with env
// vars rather than mocks - the seam pin-audit.bats already uses.

import { join } from "node:path";

export interface Env {
  readonly home: string;
  /** Directory holding annotate.jsonl. */
  readonly stateDir: string;
  readonly logPath: string;
  readonly editor: string;
  /** tmux pane this process is running in, when there is one. */
  readonly tmuxPane: string | null;
}

/**
 * `ANNOTATE_STATE_DIR` overrides, else `$XDG_STATE_HOME/agents`, else
 * `~/.local/state/agents` - papercut's convention, so the agent state files
 * sit together.
 */
export const readEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const home = source["HOME"] ?? "";
  const xdgState = source["XDG_STATE_HOME"] ?? join(home, ".local", "state");
  const stateDir = source["ANNOTATE_STATE_DIR"] ?? join(xdgState, "agents");
  const pane = source["TMUX_PANE"];
  return {
    home,
    stateDir,
    logPath: join(stateDir, "annotate.jsonl"),
    editor: source["ANNOTATE_EDITOR"] ?? source["VISUAL"] ?? source["EDITOR"] ?? "vi",
    tmuxPane: pane !== undefined && pane.length > 0 ? pane : null,
  };
};
