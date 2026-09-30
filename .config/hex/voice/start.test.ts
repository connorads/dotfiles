import { describe, expect, test } from "bun:test"
import { JUMP_FLOOR, type JevChoice } from "./goto.ts"
import { decideStart, dirLabel, MAX_DIRS, parseZoxide, startQuestion } from "./start.ts"

const HOME = "/Users/me"
const ZOXIDE = ` 284.0 /Users/me/git
  92.0 /Users/me/git/klimble
   7.5 /Users/me/git/wedding-site
`
const DIRS = parseZoxide(ZOXIDE, HOME)

const answer = (probabilities: Record<string, number>): JevChoice => ({
  choice: Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0],
  probabilities,
  confidence: 0.9,
})

describe("parseZoxide", () => {
  test("keeps score order and appends home when absent", () => {
    expect(DIRS.map((d) => d.path)).toEqual([
      "/Users/me/git",
      "/Users/me/git/klimble",
      "/Users/me/git/wedding-site",
      HOME,
    ])
  })

  test("does not duplicate home when zoxide lists it", () => {
    expect(parseZoxide(`  50.0 ${HOME}\n  10.0 /Users/me/git\n`, HOME).map((d) => d.path)).toEqual([
      HOME,
      "/Users/me/git",
    ])
  })

  test("caps the list before adding home", () => {
    const many = Array.from({ length: 40 }, (_, i) => `  ${40 - i}.0 /Users/me/git/r${i}`).join("\n")
    const dirs = parseZoxide(many, HOME)
    expect(dirs).toHaveLength(MAX_DIRS + 1)
    expect(dirs.at(-1)!.path).toBe(HOME)
  })

  test("paths with spaces survive", () => {
    expect(parseZoxide("  3.0 /Users/me/My Projects/app\n", HOME)[0]!.path).toBe("/Users/me/My Projects/app")
  })
})

test("dirLabel is relative to home, and names home", () => {
  expect(dirLabel("/Users/me/git/klimble", HOME)).toBe("git/klimble")
  expect(dirLabel(HOME, HOME)).toBe("home, dotfiles")
  expect(dirLabel("/opt/thing", HOME)).toBe("/opt/thing")
})

test("startQuestion keys dirs d1..dN plus none", () => {
  const q = startQuestion("klimble", DIRS)
  expect(q.state).toEqual({ utterance: "klimble" })
  expect(q.questions.dir.criteria).toEqual({
    d1: "git",
    d2: "git/klimble",
    d3: "git/wedding-site",
    d4: "home, dotfiles",
    none: "none of these folders; the user means something else",
  })
})

describe("decideStart", () => {
  test("a clear pick at or above the floor starts", () => {
    expect(decideStart(answer({ d2: JUMP_FLOOR, d1: 0.2, none: 0.1 }), DIRS)).toEqual({
      kind: "start",
      dir: DIRS[1]!,
      p: JUMP_FLOOR,
    })
  })

  test("a pick below the floor asks with the top two folders", () => {
    const d = decideStart(answer({ d2: 0.5, none: 0.3, d3: 0.2 }), DIRS)
    expect(d.kind === "ask" && d.options.map((o) => o.dir.label)).toEqual(["git/klimble", "git/wedding-site"])
  })

  test("none on top is no match", () => {
    expect(decideStart(answer({ none: 0.9, d1: 0.1 }), DIRS).kind).toBe("nomatch")
  })

  test("a key Jev invented is no match, never a start", () => {
    expect(decideStart(answer({ d99: 0.99 }), DIRS).kind).toBe("nomatch")
  })

  test("empty probabilities is no match", () => {
    expect(decideStart({ choice: "d1", probabilities: {}, confidence: 0 }, DIRS).kind).toBe("nomatch")
  })
})
