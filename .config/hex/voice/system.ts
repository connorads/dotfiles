// Adapters for Ports. HEX's Bun host runs with a GUI-app environment: no LANG
// and a bare PATH. Without a UTF-8 LANG, `agent ls --json` returns [] rather
// than failing, so every spawn sets LANG and PATH and uses absolute paths.
import { appendFile, mkdir } from "node:fs/promises"
import { basename, dirname } from "node:path"
import { parseJevChoice } from "./goto.ts"
import { err, ok, parsePanes, type PaneId, type Result } from "./pane.ts"
import type { Ports } from "./ports.ts"
import { parseZoxide } from "./start.ts"

const HOME = process.env.HOME ?? ""
const USER = process.env.USER ?? ""
const NIX_BIN = `/etc/profiles/per-user/${USER}/bin`
const AGENT = `${HOME}/.local/bin/agent`
const TMUX = `${NIX_BIN}/tmux`
const ZOXIDE = `${NIX_BIN}/zoxide`
const AGENT_POPUP = `${HOME}/.config/tmux/scripts/agent-popup.sh`
const LOG_PATH = `${HOME}/.local/state/hex/voice.jsonl`
const JEV_URL = "https://api.typesafe.ai/v1/systemone"
const JEV_TIMEOUT_MS = 2000
const SPAWN_TIMEOUT_MS = 5000

const ENV = {
  HOME,
  USER,
  LANG: "en_GB.UTF-8",
  PATH: `${HOME}/.local/bin:${NIX_BIN}:/run/current-system/sw/bin:/usr/bin:/bin`,
}

const run = async (argv: readonly string[]): Promise<Result<string>> => {
  try {
    const proc = Bun.spawn([...argv], { env: ENV, stdout: "pipe", stderr: "pipe", timeout: SPAWN_TIMEOUT_MS })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return code === 0 ? ok(stdout) : err(stderr.trim() || `${argv[0]} exited ${code}`)
  } catch (e) {
    return err(`${argv[0]}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const unit = (r: Result<string>): Result<void> => (r.ok ? ok(undefined) : r)

let apiKey: string | undefined
const readApiKey = async (): Promise<Result<string>> => {
  if (apiKey !== undefined) return ok(apiKey)
  const r = await run(["/usr/bin/security", "find-generic-password", "-s", "typesafe-api-key", "-w"])
  if (!r.ok || r.value.trim() === "") return err("TypeSafe API key missing from Keychain (typesafe-api-key)")
  apiKey = r.value.trim()
  return ok(apiKey)
}

const listPanes: Ports["listPanes"] = async () => {
  const [agents, titles] = await Promise.all([
    run([AGENT, "ls", "--json"]),
    run([TMUX, "list-panes", "-a", "-F", "#{pane_id}\x1f#{pane_title}"]),
  ])
  if (!agents.ok) return err(`agent ls: ${agents.error}`)
  return parsePanes(agents.value, titles.ok ? titles.value : "")
}

const judge: Ports["judge"] = async (body, question) => {
  const key = await readApiKey()
  if (!key.ok) return key
  try {
    const res = await fetch(JEV_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key.value}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
    })
    if (!res.ok) return err(`Jev HTTP ${res.status}`)
    return parseJevChoice(await res.json(), question)
  } catch (e) {
    return err(e instanceof Error && e.name === "TimeoutError" ? "Jev timed out" : `Jev: ${String(e)}`)
  }
}

const currentPane: Ports["currentPane"] = async () => {
  const r = await run([TMUX, "display-message", "-p", "#{pane_id}"])
  const id = r.ok ? r.value.trim() : ""
  return /^%\d+$/.test(id) ? (id as PaneId) : undefined
}

const listDirs: Ports["listDirs"] = async () => {
  const r = await run([ZOXIDE, "query", "-l", "-s"])
  return r.ok ? ok(parseZoxide(r.value, HOME)) : err(`zoxide: ${r.error}`)
}

// claude is typed into the window's login shell rather than run as the window
// command, so it gets the normal shell env and the pane stays a shell after
// claude exits, as when started by hand.
const startAgent: Ports["startAgent"] = async (dir) => {
  const session = await run([TMUX, "display-message", "-p", "#{session_name}"])
  if (!session.ok) return err(`tmux session: ${session.error}`)
  const target = `${session.value.trim()}:`
  const window = await run([TMUX, "new-window", "-t", target, "-c", dir, "-n", basename(dir), "-P", "-F", "#{pane_id}"])
  if (!window.ok) return err(`tmux new-window: ${window.error}`)
  const pane = window.value.trim()
  if (!/^%\d+$/.test(pane)) return err(`tmux new-window returned ${JSON.stringify(pane)}`)
  const typed = await run([TMUX, "send-keys", "-t", pane, "claude", "Enter"])
  return typed.ok ? ok(pane as PaneId) : err(`tmux send-keys: ${typed.error}`)
}

const notify: Ports["notify"] = async (title, message) => {
  await run([
    "/usr/bin/osascript",
    "-e",
    "on run argv",
    "-e",
    "display notification (item 2 of argv) with title (item 1 of argv)",
    "-e",
    "end run",
    title,
    message,
  ])
}

const log: Ports["log"] = async (entry) => {
  try {
    await mkdir(dirname(LOG_PATH), { recursive: true })
    await appendFile(LOG_PATH, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`)
  } catch {
    // Logging is for tuning thresholds; a full disk must not break the command.
  }
}

export const systemPorts: Ports = {
  listPanes,
  judge,
  jump: async (pane) => unit(await run([AGENT, "goto", pane])),
  currentPane,
  listDirs,
  startAgent,
  cycle: async (state, from) => unit(await run(["/bin/sh", AGENT_POPUP, "cycle", state, ...(from ? [from] : [])])),
  notify,
  log,
  now: () => performance.now(),
}
