// "go to <description>": the Jev question and the jump policy. Pure.
import { err, ok, paneLabel, type Pane, type Result } from "./pane.ts"

// Spike: a "none" option plus this floor gave zero wrong jumps over 11 phrases.
export const JUMP_FLOOR = 0.7
export const JEV_MODEL = "jev-latest"
const NONE = "none"

export interface JevChoice {
  readonly choice: string
  readonly probabilities: Readonly<Record<string, number>>
  readonly confidence: number
}

export interface Scored {
  readonly pane: Pane
  readonly p: number
}

export type GotoDecision =
  | { readonly kind: "jump"; readonly pane: Pane; readonly p: number }
  | { readonly kind: "ask"; readonly reason: "low-confidence" | "duplicate-title"; readonly options: readonly Scored[] }
  | { readonly kind: "nomatch"; readonly reason: string }

export const gotoQuestion = (utterance: string, panes: readonly Pane[]) => ({
  model: JEV_MODEL,
  state: { utterance },
  questions: {
    pane: {
      type: "choice",
      instructions:
        "The user spoke `utterance` (speech-to-text, may be misheard) to jump to one of their terminal panes, each running a coding agent. Labels are title (project, agent, state). Which pane do they mean? Answer none if no pane fits.",
      criteria: {
        ...Object.fromEntries(panes.map((p) => [p.id, paneLabel(p)])),
        [NONE]: "none of these panes; the user means something else",
      } as Record<string, string>,
    },
  },
})

export const parseJevChoice = (body: unknown, question: string): Result<JevChoice> => {
  const a = (body as { answers?: Record<string, unknown> } | null)?.answers?.[question]
  if (typeof a !== "object" || a === null) return err(`Jev response has no answers.${question}`)
  const { choice, probabilities, confidence } = a as Record<string, unknown>
  if (typeof choice !== "string") return err("Jev answer has no choice")
  if (typeof probabilities !== "object" || probabilities === null) return err("Jev answer has no probabilities")
  const probs = Object.fromEntries(
    Object.entries(probabilities).filter((e): e is [string, number] => typeof e[1] === "number"),
  )
  return ok({ choice, probabilities: probs, confidence: typeof confidence === "number" ? confidence : 0 })
}

const sameTitle = (a: Pane, b: Pane) => a.title !== "" && a.title.toLowerCase() === b.title.toLowerCase()

export const decideGoto = (answer: JevChoice, panes: readonly Pane[]): GotoDecision => {
  const byId = new Map<string, Pane>(panes.map((p) => [p.id, p]))
  const ranked = Object.entries(answer.probabilities).sort((x, y) => y[1] - x[1])
  const [top] = ranked
  if (top === undefined) return { kind: "nomatch", reason: "Jev returned no probabilities" }
  const [topId, topP] = top
  if (topId === NONE) return { kind: "nomatch", reason: "no pane matches" }
  const pane = byId.get(topId)
  if (pane === undefined) return { kind: "nomatch", reason: `Jev chose unknown pane ${topId}` }

  const scoredPanes: Scored[] = ranked.flatMap(([id, p]) => {
    const found = byId.get(id)
    return found ? [{ pane: found, p }] : []
  })
  if (panes.some((other) => other.id !== pane.id && sameTitle(other, pane))) {
    const twins = scoredPanes.filter((s) => sameTitle(s.pane, pane))
    return { kind: "ask", reason: "duplicate-title", options: twins.slice(0, 2) }
  }
  if (topP < JUMP_FLOOR) return { kind: "ask", reason: "low-confidence", options: scoredPanes.slice(0, 2) }
  return { kind: "jump", pane, p: topP }
}
