import { describe, expect, test } from "bun:test"
import { decideGoto, gotoQuestion, JUMP_FLOOR, parseJevChoice, type JevChoice } from "./goto.ts"
import type { Pane, PaneId } from "./pane.ts"

const pane = (id: string, title: string, project = "proj"): Pane => ({
  id: id as PaneId,
  state: "idle",
  kind: "claude",
  project,
  title,
})

const PANES = [
  pane("%1", "Computer crash watchdog timeout"),
  pane("%2", "Meeting prep with Ben", "notes"),
  pane("%3", "Meeting prep with Ben", "work"),
  pane("%4", "voice-pane-navigation"),
]

const answer = (probabilities: Record<string, number>): JevChoice => ({
  choice: Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0],
  probabilities,
  confidence: 0.9,
})

describe("decideGoto", () => {
  test("a clear pick at or above the floor jumps", () => {
    const d = decideGoto(answer({ "%1": JUMP_FLOOR, "%4": 0.2, none: 0.1 }), PANES)
    expect(d).toEqual({ kind: "jump", pane: PANES[0]!, p: JUMP_FLOOR })
  })

  test("a pick below the floor asks with the top two panes", () => {
    const d = decideGoto(answer({ "%1": 0.5, none: 0.3, "%4": 0.2 }), PANES)
    expect(d.kind === "ask" && [d.reason, d.options.map((o): string => o.pane.id)]).toEqual([
      "low-confidence",
      ["%1", "%4"],
    ])
  })

  test("duplicate titles ask even when confident", () => {
    const d = decideGoto(answer({ "%2": 0.8, "%3": 0.15, "%1": 0.05 }), PANES)
    expect(d.kind === "ask" && [d.reason, d.options.map((o): string => o.pane.id)]).toEqual([
      "duplicate-title",
      ["%2", "%3"],
    ])
  })

  test("none on top is no match", () => {
    expect(decideGoto(answer({ none: 0.9, "%1": 0.1 }), PANES).kind).toBe("nomatch")
  })

  test("an id Jev invented is no match, never a jump", () => {
    expect(decideGoto(answer({ "%77": 0.99 }), PANES).kind).toBe("nomatch")
  })

  test("empty probabilities is no match", () => {
    expect(decideGoto({ choice: "%1", probabilities: {}, confidence: 0 }, PANES).kind).toBe("nomatch")
  })
})

test("gotoQuestion offers every pane by id plus none", () => {
  const q = gotoQuestion("the crash one", PANES)
  expect(q.state).toEqual({ utterance: "the crash one" })
  expect(Object.keys(q.questions.pane.criteria)).toEqual(["%1", "%2", "%3", "%4", "none"])
  expect(q.questions.pane.criteria["%2"]).toBe("Meeting prep with Ben (notes, claude, idle)")
})

describe("parseJevChoice", () => {
  test("reads answers.pane", () => {
    const r = parseJevChoice({ answers: { pane: { choice: "%1", probabilities: { "%1": 0.9 }, confidence: 0.8 } } })
    expect(r).toEqual({ ok: true, value: { choice: "%1", probabilities: { "%1": 0.9 }, confidence: 0.8 } })
  })

  test("rejects a response without the answer", () => {
    expect(parseJevChoice({ error: "bad key" }).ok).toBe(false)
    expect(parseJevChoice(null).ok).toBe(false)
  })
})
