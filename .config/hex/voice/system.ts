// Adapters for Ports. The command pedal runs as a launchd login item with a
// bare GUI-app environment, so every spawn uses an absolute path.
import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { err, ok, parseJevChoice, type Result } from "./jev.ts"
import type { Ports } from "./ports.ts"

const HOME = process.env.HOME ?? ""
const LOG_PATH = `${HOME}/.local/state/hex/voice.jsonl`
const JEV_URL = "https://api.typesafe.ai/v1/systemone"
const JEV_TIMEOUT_MS = 2000
const SPAWN_TIMEOUT_MS = 5000

const run = async (argv: readonly string[]): Promise<Result<string>> => {
  try {
    const proc = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe", timeout: SPAWN_TIMEOUT_MS })
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

let apiKey: string | undefined
const readApiKey = async (): Promise<Result<string>> => {
  if (apiKey !== undefined) return ok(apiKey)
  const r = await run(["/usr/bin/security", "find-generic-password", "-s", "typesafe-api-key", "-w"])
  if (!r.ok || r.value.trim() === "") return err("TypeSafe API key missing from Keychain (typesafe-api-key)")
  apiKey = r.value.trim()
  return ok(apiKey)
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

export const systemPorts: Ports = { judge, notify, log }
