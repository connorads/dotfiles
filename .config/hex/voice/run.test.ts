import { beforeEach, describe, expect, test } from "bun:test"
import { err, ok, type Pane, type PaneId, type Result } from "./pane.ts"
import type { JevChoice } from "./goto.ts"
import type { CycleState, Ports } from "./ports.ts"
import { runGoto, runNext } from "./run.ts"

const pane = (id: string, title: string): Pane => ({
  id: id as PaneId,
  state: "blocked",
  kind: "claude",
  project: "proj",
  title,
})
const PANES = [pane("%1", "Crash watchdog"), pane("%2", "Voice commands")]

interface World {
  panes: Result<readonly Pane[]>
  verdict: Result<JevChoice>
  jumped: PaneId[]
  cycled: Array<[CycleState, PaneId | undefined]>
  notes: string[]
  logs: Record<string, unknown>[]
}

let w: World
const ports = (): Ports => ({
  listPanes: async () => w.panes,
  judge: async () => w.verdict,
  jump: async (id) => {
    w.jumped.push(id)
    return ok(undefined)
  },
  currentPane: async () => "%2" as PaneId,
  cycle: async (state, from) => {
    w.cycled.push([state, from])
    return ok(undefined)
  },
  notify: async (title, message) => {
    w.notes.push(`${title}: ${message}`)
  },
  log: async (entry) => {
    w.logs.push(entry)
  },
  now: () => 0,
})
const verdict = (probabilities: Record<string, number>) =>
  ok({ choice: Object.keys(probabilities)[0]!, probabilities, confidence: 0.9 })

beforeEach(() => {
  w = { panes: ok(PANES), verdict: verdict({ "%1": 0.9 }), jumped: [], cycled: [], notes: [], logs: [] }
})

describe("runGoto", () => {
  test("a confident pick jumps silently and logs", async () => {
    expect(await runGoto(ports(), "the crash one")).toBe("jump")
    expect(w.jumped).toEqual(["%1" as PaneId])
    expect(w.notes).toEqual([])
    expect(w.logs).toMatchObject([{ command: "goto", utterance: "the crash one", outcome: "jump", pane: "%1" }])
  })

  test("an uncertain pick notifies both options and does not jump", async () => {
    w.verdict = verdict({ "%1": 0.5, "%2": 0.4 })
    expect(await runGoto(ports(), "the thing")).toBe("ask")
    expect(w.jumped).toEqual([])
    expect(w.notes).toEqual(["Go to pane: which one?: Crash watchdog (proj) or Voice commands (proj)"])
    expect(w.logs[0]).toMatchObject({ outcome: "ask", reason: "low-confidence" })
  })

  test("no match notifies and does not jump", async () => {
    w.verdict = verdict({ none: 0.95 })
    expect(await runGoto(ports(), "my tax return")).toBe("nomatch")
    expect(w.jumped).toEqual([])
    expect(w.notes).toEqual(['Go to pane: No match for "my tax return"'])
  })

  test("a Jev failure notifies the reason and does not jump", async () => {
    w.verdict = err("Jev timed out")
    expect(await runGoto(ports(), "anything")).toBe("error")
    expect(w.jumped).toEqual([])
    expect(w.notes).toEqual(["Go to pane: Jev timed out"])
    expect(w.logs[0]).toMatchObject({ outcome: "error", error: "Jev timed out" })
  })

  test("no panes notifies without asking Jev", async () => {
    w.panes = ok([])
    w.verdict = verdict({ "%1": 1 })
    expect(await runGoto(ports(), "anything")).toBe("error")
    expect(w.jumped).toEqual([])
    expect(w.notes).toEqual(["Go to pane: no agent panes found"])
  })
})

describe("runNext", () => {
  test("cycles from the current pane and logs", async () => {
    expect(await runNext(ports(), "blocked")).toBe(true)
    expect(w.cycled).toEqual([["blocked", "%2" as PaneId]])
    expect(w.logs).toMatchObject([{ command: "next", state: "blocked", outcome: "cycle" }])
  })
})
