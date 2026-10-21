import { describe, expect, test } from "bun:test"
import { paneLabel, parsePanes, stripGlyph } from "./pane.ts"

// Synthetic agent rows and pane titles exercise the two command output formats.
const AGENT_JSON = JSON.stringify([
  { pane: "%48", state: "blocked", kind: "claude", name: null, loc: "alpha:2.1", window: "claude", cwd: "/work/project-alpha" },
  { pane: "%87", state: "working", kind: "claude", name: null, loc: "git:4.1", window: "claude", cwd: "/work/projects" },
  { pane: "%4", state: "idle", kind: "claude", name: null, loc: "beta:2.1", window: "claude", cwd: "/work/project-beta" },
])
const TITLES = [
  "%4\x1f✳ example-idle-task",
  "%48\x1f✳ Example blocked task",
  "%87\x1f⠂ example-active-task",
  "%99\x1fzsh",
].join("\n")

describe("parsePanes", () => {
  test("joins agent rows with glyph-stripped titles", () => {
    const r = parsePanes(AGENT_JSON, TITLES)
    if (!r.ok) throw new Error(r.error)
    expect(r.value).toEqual([
      { id: "%48", state: "blocked", kind: "claude", project: "project-alpha", title: "Example blocked task" },
      { id: "%87", state: "working", kind: "claude", project: "projects", title: "example-active-task" },
      { id: "%4", state: "idle", kind: "claude", project: "project-beta", title: "example-idle-task" },
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
  expect(r.ok && paneLabel(r.value[0]!)).toBe("Example blocked task (project-alpha, claude, blocked, waiting on the user)")
})
