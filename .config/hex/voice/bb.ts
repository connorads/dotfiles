import type { Candidate, Command, Kind, Reply } from "../../../src/bb-plugins/handsfree/contracts.ts"
import { JEV_MODEL } from "./goto.ts"
import type { Ports } from "./ports.ts"

export interface BbPorts extends Pick<Ports, "judge" | "notify" | "log"> {
  readonly request: (command: Command) => Promise<Reply>
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const modifiers = ["command", "control", "option", "shift"]

export const parseReply = (value: unknown): Reply => {
  if (!record(value) || typeof value.ok !== "boolean" || typeof value.message !== "string"
    || (value.context !== undefined && typeof value.context !== "string")
    || (value.candidates !== undefined && (!Array.isArray(value.candidates) || !value.candidates.every(candidate =>
      record(candidate) && typeof candidate.id === "string" && typeof candidate.label === "string")))
    || (value.press !== undefined && (!record(value.press) || typeof value.press.key !== "string"
      || !Array.isArray(value.press.modifiers) || !value.press.modifiers.every(modifier => modifiers.includes(modifier))))) {
    throw new Error("BB returned an invalid voice response.")
  }
  return value as Reply
}

export const requestBb = async (command: Command): Promise<Reply> => {
  const proc = Bun.spawn([
    "/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb",
    "handsfree", "command", JSON.stringify(command),
  ], { stdout: "pipe", stderr: "pipe", timeout: 25000 })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ])
  if (!stdout.trim()) throw new Error(stderr.trim() || `BB voice command failed (${code}). Open BB and check the Handsfree plugin.`)
  return parseReply(JSON.parse(stdout))
}

export const runBb = async (ports: BbPorts, command: Command): Promise<Reply> => {
  try {
    const reply = await ports.request(command)
    if (!reply.ok) await ports.notify("BB voice", reply.message)
    await ports.log({ command: "bb", action: command.action, ok: reply.ok, message: reply.message })
    return reply
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    await ports.notify("BB voice", message)
    await ports.log({ command: "bb", action: command.action, ok: false, message })
    return { ok: false, message }
  }
}

const normalise = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()

export const matchBb = async (ports: BbPorts, kind: Kind, utterance: string): Promise<Reply> => {
  const list = await runBb(ports, { action: "list", kind })
  if (!list.ok) return list
  const { candidates = [], context } = list
  if (!context || candidates.length === 0) return runBb(ports, { action: "notice", message: `No ${kind} choices are available here.` })
  const target = normalise(kind === "project" && normalise(utterance) === "dotfiles" ? "connorads" : utterance)
  const exact = candidates.filter(candidate => normalise(candidate.label) === target || normalise(candidate.id) === target)
  let matches = exact.length ? exact : candidates.filter(candidate => normalise(candidate.label).includes(target))
  const show = (options: Candidate[]) => runBb(ports, {
    action: "choices", kind, context, options: options.slice(0, 9), message: `Choose a ${kind} for “${utterance}”.`,
  })
  const [single] = matches
  if (matches.length === 1 && single) return runBb(ports, { action: "select", kind, context, id: single.id })
  if (matches.length > 1) return show(matches)
  const answer = await ports.judge({
    model: JEV_MODEL,
    state: { utterance },
    questions: { target: {
      type: "choice",
      instructions: `Match the spoken description to a BB ${kind}. Speech may be misheard. Choose none when nothing fits.`,
      criteria: { ...Object.fromEntries(candidates.map(candidate => [candidate.id, candidate.label])), none: "None of these choices" },
    } },
  }, "target")
  if (!answer.ok) return runBb(ports, { action: "notice", message: `${answer.error}. Try an exact name.` })
  const ranked = Object.entries(answer.value.probabilities)
    .filter(([, probability]) => Number.isFinite(probability) && probability >= 0 && probability <= 1)
    .sort((a, b) => b[1] - a[1])
  const top = ranked[0]
  const selected = candidates.find(candidate => candidate.id === top?.[0])
  if (!top || !selected || answer.value.choice !== top[0]) {
    return runBb(ports, { action: "notice", message: `No ${kind} matches “${utterance}”. Try a title or name.` })
  }
  if (top[1] >= 0.7 && top[1] - (ranked[1]?.[1] ?? 0) >= 0.2) {
    return runBb(ports, { action: "select", kind, context, id: selected.id })
  }
  matches = ranked.flatMap(([id]) => candidates.filter(candidate => candidate.id === id)).slice(0, 3)
  return show(matches)
}
