// Talking to tmux. Argv-form spawns, never a shell string, so a pane id or a
// path holding a space or a quote cannot become syntax.

/** What a pane can tell us about itself, for an excerpt's Origin. */
export interface PaneInfo {
  readonly pane: string;
  readonly session: string | null;
  readonly cwd: string | null;
  readonly agentKind: string | null;
  readonly agentName: string | null;
}

// ASCII unit separator: tmux passes it through format expansion untouched,
// and no session name, path or agent label can contain one.
const FIELD = "\u001f";

// One round trip for every field. `@agent_kind` and `@agent_name` are the pane
// options agent-state.sh maintains, so this reads the same labels `agent ls`
// shows rather than sniffing pane_current_command a second time.
const PANE_FORMAT = [
  "#{pane_id}",
  "#{session_name}",
  "#{pane_current_path}",
  "#{@agent_kind}",
  "#{@agent_name}",
].join(FIELD);

const blankToNull = (value: string | undefined): string | null =>
  value === undefined || value.length === 0 ? null : value;

const run = async (args: readonly string[]): Promise<{ code: number; stdout: string }> => {
  try {
    const child = Bun.spawn(["tmux", ...args], { stdout: "pipe", stderr: "ignore" });
    const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return { code, stdout };
  } catch {
    // tmux absent, or no server. Indistinguishable here and treated the same:
    // provenance is enrichment, so its absence must not fail a capture.
    return { code: 127, stdout: "" };
  }
};

/**
 * Everything a pane knows about itself, or null when it cannot be resolved.
 *
 * `display-message` exits 0 for a pane that does not exist and prints an empty
 * line, so the empty `pane_id` is the only reliable signal that the target is
 * gone - the exit code says nothing.
 */
export const paneInfo = async (paneId: string): Promise<PaneInfo | null> => {
  const { code, stdout } = await run(["display-message", "-p", "-t", paneId, "-F", PANE_FORMAT]);
  if (code !== 0) return null;
  const fields = stdout.replace(/\n$/, "").split(FIELD);
  const pane = blankToNull(fields[0]);
  if (pane === null) return null;
  return {
    pane,
    session: blankToNull(fields[1]),
    cwd: blankToNull(fields[2]),
    agentKind: blankToNull(fields[3]),
    agentName: blankToNull(fields[4]),
  };
};
