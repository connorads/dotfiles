import { replySchema, type Candidate, type Command, type Kind, type Reply } from "../../../src/bb-plugins/handsfree/contracts.ts"
import { JEV_MODEL } from "./goto.ts"
import type { Ports } from "./ports.ts"

export interface BbPorts extends Pick<Ports, "judge" | "notify" | "log"> {
  readonly request: (command: Command) => Promise<Reply>
}

export const parseReply = (value: unknown): Reply => {
  const parsed = replySchema.safeParse(value)
  if (!parsed.success) throw new Error("BB returned an invalid voice response.")
  return parsed.data
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

const words = (text: string) => normalise(text).split(" ").filter(Boolean)
  .map(word => word.length > 3 ? word.replace(/s$/, "") : word)

const nearWord = (left: string, right: string): boolean => {
  if (left === right) return true
  if (Math.min(left.length, right.length) < 3 || Math.abs(left.length - right.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (left.length >= right.length) i++
    if (right.length >= left.length) j++
  }
  return edits + (left.length - i) + (right.length - j) <= 1
}

const approximate = (candidates: Candidate[], target: string): Candidate[] => {
  const query = words(target)
  if (query.length < 2) return []
  return candidates.flatMap(candidate => {
    const available = words(`${candidate.title ?? candidate.label} ${candidate.project ?? ""}`)
    let exact = 0, edits = 0
    for (const word of query) {
      let index = available.indexOf(word)
      if (index >= 0) exact++
      else { index = available.findIndex(option => nearWord(word, option)); edits++ }
      if (index < 0 || edits > 1) return []
      available.splice(index, 1)
    }
    return exact ? [{ candidate, edits }] : []
  }).sort((a, b) => a.edits - b.edits).slice(0, 3).map(row => row.candidate)
}

export const matchBb = async (ports: BbPorts, kind: Kind, utterance: string): Promise<Reply> => {
  if (utterance) await runBb(ports, { action: "notice", message: `Heard ${kind} target: “${utterance}”.` })
  const spoken = normalise(utterance)
  if (kind === "thread") {
    const navigation = spoken.replace(/^the /, "")
    if (navigation === "next thread" || navigation === "previous thread") {
      return runBb(ports, { action: navigation === "next thread" ? "next" : "previous" })
    }
  }
  const list = await runBb(ports, { action: "list", kind })
  if (!list.ok) return list
  const { candidates = [], context } = list
  if (!context || candidates.length === 0) return runBb(ports, { action: "notice", message: `No ${kind} choices are available here.` })
  const target = kind === "thread"
    ? spoken.replace(/^the /, "").replace(/ threads?$/, "") || spoken
    : kind === "project" && spoken === "dotfiles" ? "connorads" : spoken
  const name = (candidate: Candidate) => normalise(candidate.title ?? candidate.label)
  const exact = candidates.filter(candidate => name(candidate) === target || normalise(candidate.id) === target)
  let matches = exact.length ? exact : candidates.filter(candidate => name(candidate).includes(target))
  const show = (options: Candidate[]) => runBb(ports, {
    action: "choices", kind, context, options: options.slice(0, 9), message: utterance ? `Choose a ${kind} for “${utterance}”.` : "Choose a project for a new draft.",
  })
  if (!spoken) return show(candidates)
  const [single] = matches
  if (matches.length === 1 && single) return runBb(ports, { action: "select", kind, context, id: single.id })
  if (matches.length > 1) return show(matches)
  if (kind === "thread") {
    matches = approximate(candidates, target)
    if (matches.length) return show(matches)
  }
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
