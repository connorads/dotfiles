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

const exchange = async (ports: BbPorts, command: Command): Promise<Reply> => {
  try {
    const reply = await ports.request(command)
    if (!reply.ok) await ports.notify("BB voice", reply.message)
    return reply
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    await ports.notify("BB voice", message)
    return { ok: false, outcome: "error", message }
  }
}

const outcome = (reply: Reply, command: Command): NonNullable<Reply["outcome"]> => reply.outcome ?? (!reply.ok ? "error"
  : command.action === "choices" ? "choices"
    : command.action === "next" || command.action === "previous" || (command.action === "select" && command.kind === "thread") ? "requested" : "completed")

export const runBb = async (ports: BbPorts, command: Command): Promise<Reply> => {
  const started = performance.now()
  const reply = await exchange(ports, command)
  await ports.log({ command: "bb", action: command.action, ok: reply.ok, outcome: outcome(reply, command),
    requestId: reply.requestId, message: reply.message, ms: performance.now() - started })
  return reply
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

const searchBb = async (ports: BbPorts, kind: Kind, utterance: string, { trace, choose }: { trace: Record<string, unknown>; choose: boolean }): Promise<Reply> => {
  const steps: Record<string, unknown>[] = []
  trace.steps = steps
  const request = async (command: Command): Promise<Reply> => {
    const started = performance.now()
    const reply = await exchange(ports, command)
    const result = { ...reply, outcome: outcome(reply, command) }
    steps.push({ action: command.action, requestId: result.requestId, ok: result.ok, ms: performance.now() - started })
    return result
  }
  const notice = async (message: string, result: 'no-match' | 'error'): Promise<Reply> => {
    const reply = await request({ action: 'notice', message, problem: true })
    return { ...reply, ok: false, outcome: result }
  }
  if (utterance) await request({ action: "notice", message: `Heard ${kind} target: “${utterance}”.` })
  const numbers: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" }
  const spoken = kind === "model"
    ? normalise(utterance).split(" ").map(word => numbers[word] ?? word).join(" ").replace(/(\d) point (?=\d)/g, "$1 ")
    : normalise(utterance)
  if (kind === "thread") {
    const navigation = spoken.replace(/^the /, "")
    if (navigation === "next thread" || navigation === "previous thread") {
      trace.method = 'navigation'
      return request({ action: navigation === "next thread" ? "next" : "previous" })
    }
  }
  const list = await request({ action: "list", kind })
  if (!list.ok) return list
  const { candidates = [], context } = list
  trace.candidateCount = candidates.length
  if (!context || candidates.length === 0) return notice(`No ${kind} choices are available here.`, 'no-match')
  const target = kind === "thread"
    ? spoken.replace(/^the /, "").replace(/ threads?$/, "") || spoken
    : kind === "project" && spoken.replaceAll(" ", "") === "dotfiles" ? "connorads" : spoken
  const name = (candidate: Candidate) => normalise(candidate.title ?? candidate.label)
  const exact = candidates.filter(candidate => name(candidate) === target || normalise(candidate.id) === target)
  let matches = exact.length ? exact : candidates.filter(candidate => name(candidate).includes(target)
    || ((kind === "model" || kind === "favourite") && normalise(candidate.label).includes(target))
    || (kind === "thread" && name(candidate).replaceAll(" ", "").includes(target.replaceAll(" ", ""))))
  const show = (options: Candidate[]) => {
    trace.offered = options.slice(0, 9)
    return request({
    action: "choices", kind, context, options: options.slice(0, 9), message: utterance ? `Choose a ${kind} for “${utterance}”.` : kind === "project" ? "Choose a project for a new draft." : `Choose a ${kind}.`,
    })
  }
  trace.method = 'literal'
  if (!spoken) return show(candidates)
  const [single] = matches
  const select = (candidate: Candidate) => {
    trace.selected = candidate
    return request({ action: "select", kind, context, id: candidate.id })
  }
  if (matches.length === 1 && single) return choose ? show([single]) : select(single)
  if (matches.length > 1) return show(matches)
  if (kind === "thread") {
    matches = approximate(candidates, target)
    if (matches.length) { trace.method = 'approximate'; return show(matches) }
  }
  trace.method = 'semantic'
  const judgedAt = performance.now()
  const answer = await ports.judge({
    model: JEV_MODEL,
    state: { utterance },
    questions: { target: {
      type: "choice",
      instructions: `Match the spoken description to a BB ${kind}. Speech may be misheard. Choose none when nothing fits.`,
      criteria: { ...Object.fromEntries(candidates.map(candidate => [candidate.id, candidate.label])), none: "None of these choices" },
    } },
  }, "target")
  trace.judgeMs = performance.now() - judgedAt
  if (!answer.ok) { trace.error = answer.error; return notice(`${answer.error}. Try an exact name.`, 'error') }
  trace.choice = answer.value.choice
  trace.probabilities = answer.value.probabilities
  trace.confidence = answer.value.confidence
  trace.candidates = candidates
  const ranked = Object.entries(answer.value.probabilities)
    .filter(([, probability]) => Number.isFinite(probability) && probability >= 0 && probability <= 1)
    .sort((a, b) => b[1] - a[1])
  const top = ranked[0]
  const selected = candidates.find(candidate => candidate.id === top?.[0])
  if (!top || !selected || answer.value.choice !== top[0]) {
    return notice(`No ${kind} matches “${utterance}”. Try a title or name.`, 'no-match')
  }
  if (top[1] >= 0.7 && top[1] - (ranked[1]?.[1] ?? 0) >= 0.2) {
    return choose ? show([selected]) : select(selected)
  }
  matches = ranked.flatMap(([id]) => candidates.filter(candidate => candidate.id === id)).slice(0, 3)
  return show(matches)
}

export const matchBb = async (ports: BbPorts, kind: Kind, utterance: string, options: { choose: boolean } = { choose: false }): Promise<Reply> => {
  const started = performance.now()
  const trace: Record<string, unknown> = { command: 'bb', action: 'match', kind, utterance }
  let reply: Reply
  try { reply = await searchBb(ports, kind, utterance, { trace, choose: options.choose }) }
  catch (cause) {
    reply = { ok: false, outcome: 'error', message: cause instanceof Error ? cause.message : String(cause) }
    await exchange(ports, { action: 'notice', message: reply.message })
  }
  await ports.log({ ...trace, ok: reply.ok, outcome: reply.outcome, requestId: reply.requestId,
    message: reply.message, ms: performance.now() - started })
  return reply
}
