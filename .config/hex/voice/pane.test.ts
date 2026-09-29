import { describe, expect, test } from "bun:test"
import { paneLabel, parsePanes, stripGlyph } from "./pane.ts"

// Captured from `agent ls --json` and `tmux list-panes -a -F '#{pane_id}\037#{pane_title}'`.
const AGENT_JSON = JSON.stringify([
  { pane: "%48", state: "blocked", kind: "claude", name: null, loc: "str:2.1", window: "claude", cwd: "/Users/connorads/git/strain" },
  { pane: "%87", state: "working", kind: "claude", name: null, loc: "git:4.1", window: "claude", cwd: "/Users/connorads/git" },
  { pane: "%4", state: "idle", kind: "claude", name: null, loc: "fr:2.1", window: "claude", cwd: "/Users/connorads/git/salut-steve" },
])
const TITLES = [
  "%4\x1f✳ logging-takes-api-requests",
  "%48\x1f✳ Computer crash watchdog timeout",
  "%87\x1f⠂ voice-pane-navigation",
  "%99\x1fzsh",
].join("\n")

describe("parsePanes", () => {
  test("joins agent rows with glyph-stripped titles", () => {
    const r = parsePanes(AGENT_JSON, TITLES)
    if (!r.ok) throw new Error(r.error)
    expect(r.value).toEqual([
      { id: "%48", state: "blocked", kind: "claude", project: "strain", title: "Computer crash watchdog timeout" },
      { id: "%87", state: "working", kind: "claude", project: "git", title: "voice-pane-navigation" },
      { id: "%4", state: "idle", kind: "claude", project: "salut-steve", title: "logging-takes-api-requests" },
    ] as unknown as typeof r.value)
  })

  test("a pane with no title keeps an empty title", () => {
    const r = parsePanes(AGENT_JSON, "")
    expect(r.ok && r.value.map((p) => p.title)).toEqual(["", "", ""])
  })

  test("an agent name wins over the title", () => {
    const json = JSON.stringify([{ pane: "%4", state: "done", kind: "codex", name: "reviewer", cwd: "/x/y" }])
    const r = parsePanes(json, TITLES)
    expect(r.ok && r.value[0]?.title).toBe("reviewer")
  })

  test("unknown states parse as unknown; rows without a pane id are dropped", () => {
    const json = JSON.stringify([{ pane: "%1", state: "mystery" }, { pane: "nope" }, null])
    const r = parsePanes(json, "")
    expect(r.ok && r.value.map((p): string[] => [p.id, p.state])).toEqual([["%1", "unknown"]])
  })

  test("invalid JSON and non-lists are errors", () => {
    expect(parsePanes("[", "").ok).toBe(false)
    expect(parsePanes("{}", "").ok).toBe(false)
  })
})

test("stripGlyph removes Claude's leading status glyphs only", () => {
  expect(stripGlyph("✳ Fix 2 bugs")).toBe("Fix 2 bugs")
  expect(stripGlyph("⠐ ⠂ spinner")).toBe("spinner")
  expect(stripGlyph("3 things")).toBe("3 things")
})

test("paneLabel spells out the state for Jev", () => {
  const r = parsePanes(AGENT_JSON, TITLES)
  expect(r.ok && paneLabel(r.value[0]!)).toBe("Computer crash watchdog timeout (strain, claude, blocked, waiting on the user)")
})
