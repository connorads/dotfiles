// Agent panes as the voice commands see them: `agent ls --json` rows joined
// with tmux pane titles (Claude's session titles, which is what people say).

export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export type PaneId = string & { readonly __brand: "PaneId" }

const AGENT_STATES = ["blocked", "working", "done", "idle", "hibernated"] as const
// agent-state-lib.sh renders any other @agent_state as "·", so it can appear.
export type AgentState = (typeof AGENT_STATES)[number] | "unknown"

export interface Pane {
  readonly id: PaneId
  readonly state: AgentState
  readonly kind: string
  readonly project: string
  readonly title: string
}

const isPaneId = (s: unknown): s is PaneId => typeof s === "string" && /^%\d+$/.test(s)

const parseState = (s: unknown): AgentState =>
  AGENT_STATES.find((known) => known === s) ?? "unknown"

// Claude prefixes titles with a status glyph (✳, braille spinner frames).
export const stripGlyph = (title: string): string => title.replace(/^[^\p{L}\p{N}]+/u, "").trim()

const projectOf = (cwd: unknown): string =>
  typeof cwd === "string" ? (cwd.split("/").filter(Boolean).at(-1) ?? "~") : "?"

// titlesTsv: `tmux list-panes -a -F '#{pane_id}\037#{pane_title}'` output.
export const parseTitles = (titlesTsv: string): ReadonlyMap<string, string> =>
  new Map(
    titlesTsv
      .split("\n")
      .map((line) => line.split("\x1f"))
      .filter((parts): parts is [string, string] => parts.length === 2)
      .map(([id, title]) => [id, stripGlyph(title)]),
  )

export const parsePanes = (agentJson: string, titlesTsv: string): Result<readonly Pane[]> => {
  let rows: unknown
  try {
    rows = JSON.parse(agentJson)
  } catch {
    return err("agent ls --json returned invalid JSON")
  }
  if (!Array.isArray(rows)) return err("agent ls --json did not return a list")
  const titles = parseTitles(titlesTsv)
  const panes: Pane[] = []
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue
    const r = row as Record<string, unknown>
    if (!isPaneId(r.pane)) continue
    const name = typeof r.name === "string" && r.name !== "" ? r.name : undefined
    panes.push({
      id: r.pane,
      state: parseState(r.state),
      kind: typeof r.kind === "string" ? r.kind : "agent",
      project: projectOf(r.cwd),
      title: name ?? titles.get(r.pane) ?? "",
    })
  }
  return ok(panes)
}

const STATE_PHRASE: Record<AgentState, string> = {
  blocked: "blocked, waiting on the user",
  working: "working",
  done: "done, finished and unread",
  idle: "idle",
  hibernated: "hibernated",
  unknown: "state unknown",
}

export const paneLabel = (p: Pane): string =>
  `${p.title || "untitled"} (${p.project}, ${p.kind}, ${STATE_PHRASE[p.state]})`
