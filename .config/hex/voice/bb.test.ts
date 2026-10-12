import { expect, test } from "bun:test"
import type { Command, Reply } from "../../../src/bb-plugins/handsfree/contracts.ts"
import { matchBb, parseReply, runBb, type BbPorts } from "./bb.ts"
import { err, ok } from "./pane.ts"

const setup = (labels: string[], probabilities: Record<string, number> = {}) => {
  const commands: Command[] = []
  let judged = false
  const logs: Record<string, unknown>[] = []
  const ports: BbPorts = {
    request: async command => {
      commands.push(command)
      return command.action === "list"
        ? { ok: true, message: "", context: "window|thread:project:provider", candidates: labels.map((label, i) => ({ id: String(i), label, title: label.replace(/ \([^)]*\)$/, "") })) }
        : { ok: true, message: "Selected" }
    },
    judge: async () => { judged = true; return ok({ choice: Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none", confidence: 0.9, probabilities }) },
    notify: async () => {},
    log: async entry => { logs.push(entry) },
  }
  return { ports, commands, logs, judged: () => judged }
}

test("show threads offers numbered thread choices with a thread-specific prompt", async () => {
  const w = setup(["Login", "Billing"])
  await matchBb(w.ports, "thread", "")
  expect(w.commands.at(-1)).toMatchObject({ action: "choices", kind: "thread", message: "Choose a thread.", options: [{ id: "0" }, { id: "1" }] })
  expect(w.judged()).toBe(false)
})

test("exact names use the list's window context without calling Jev", async () => {
  const w = setup(["Login", "Billing"])
  await matchBb(w.ports, "thread", "login")
  expect(w.commands.at(-1)).toEqual({ action: "select", kind: "thread", id: "0", context: "window|thread:project:provider" })
  expect(w.judged()).toBe(false)
})

test("ambiguous model families show choices rather than guessing a version", async () => {
  const w = setup(["Claude Sonnet 4.5", "Claude Sonnet 4.6"])
  await matchBb(w.ports, "model", "Sonnet")
  expect(w.commands.at(-1)?.action).toBe("choices")
  expect(w.judged()).toBe(false)
})

test("uncertain semantic matches show numbered candidates", async () => {
  const w = setup(["Login", "Billing"], { "0": 0.55, "1": 0.4, none: 0.05 })
  await matchBb(w.ports, "thread", "authentication bug")
  expect(w.commands.at(-1)?.action).toBe("choices")
})

test("confident semantic matches select a known candidate", async () => {
  const w = setup(["Login", "Billing"], { "0": 0.9, "1": 0.05, none: 0.05 })
  await matchBb(w.ports, "thread", "authentication bug")
  expect(w.commands.at(-1)?.action).toBe("select")
})

test("unknown Jev choices never navigate", async () => {
  const w = setup(["Login"], { invented: 0.99, "0": 0.01 })
  await matchBb(w.ports, "thread", "authentication bug")
  expect(w.commands.some(c => c.action === "select")).toBe(false)
})

test("dotfiles names the live home project", async () => {
  const w = setup(["connorads", "kb"])
  await matchBb(w.ports, "project", "dotfiles")
  expect(w.commands.at(-1)).toMatchObject({ action: "select", kind: "project", id: "0" })
})

test("reply parsing rejects invalid keypresses and candidate records", () => {
  expect(() => parseReply({ ok: true, message: "", press: { key: "x", modifiers: ["invented"] } })).toThrow()
  expect(() => parseReply({ ok: true, message: "", candidates: [{ id: "a" }] })).toThrow()
  const reply: Reply = { ok: true, message: "", press: { key: "Tab", modifiers: ["control"] } }
  expect(parseReply(reply)).toEqual(reply)
})

test("navigation descriptions do not enter title search", async () => {
  for (const target of ["next thread", "the next thread", "previous thread"]) {
    const w = setup(["Next thread investigation"])
    await matchBb(w.ports, "thread", target)
    expect(w.commands.at(-1)?.action).toBe(target.includes("previous") ? "previous" : "next")
    expect(w.commands.some(c => c.action === "list")).toBe(false)
  }
})

test("thread filler words do not prevent a local title match", async () => {
  const w = setup(["Set up secure BB access across Mac devices (connorads, codex)", "Billing"])
  await matchBb(w.ports, "thread", "the access thread")
  expect(w.commands.at(-1)).toMatchObject({ action: "select", id: "0" })
  expect(w.judged()).toBe(false)
})

test("show projects offers numbered choices even for one project", async () => {
  const w = setup(["kb"])
  await matchBb(w.ports, "project", "")
  expect(w.commands.at(-1)).toMatchObject({ action: "choices", kind: "project", options: [{ id: "0", label: "kb" }] })
  expect(w.judged()).toBe(false)
})

test("search feedback preserves the heard target", async () => {
  const w = setup(["Access"])
  await matchBb(w.ports, "thread", "access thread")
  expect(w.commands[0]).toEqual({ action: "notice", message: "Heard thread target: “access thread”." })
})

test("misheard get client offers the Git clients thread without navigating or calling Jev", async () => {
  const w = setup(["Explore Git clients and design a native Git", "Explore my knowledge base", "Client billing"])
  await matchBb(w.ports, "thread", "get client thread")
  expect(w.commands.at(-1)).toMatchObject({ action: "choices", options: [{ id: "0" }] })
  expect(w.commands.some(command => command.action === "select")).toBe(false)
  expect(w.judged()).toBe(false)
})

test("reordered title words offer all plausible threads instead of choosing silently", async () => {
  const w = setup(["Fix login redirect", "Investigate login redirect", "Billing invoices"])
  await matchBb(w.ports, "thread", "redirect login")
  expect(w.commands.at(-1)).toMatchObject({ action: "choices", options: [{ id: "0" }, { id: "1" }] })
})

test("unrelated targets do not acquire fuzzy suggestions from one shared word", async () => {
  const w = setup(["Git client", "Client billing"], { none: 0.99, "0": 0.01 })
  await matchBb(w.ports, "thread", "get dinosaur")
  expect(w.commands.at(-1)).toMatchObject({ action: "notice" })
  expect(w.commands.some(command => command.action === "choices")).toBe(false)
})

test("a full title wins over another thread containing that title", async () => {
  const w = setup(["Git clients (home, codex)", "Explore Git clients (home, codex)"])
  await matchBb(w.ports, "thread", "git clients")
  expect(w.commands.at(-1)).toMatchObject({ action: "select", id: "0" })
})

test("a failed semantic search records one failed outcome with the answer and scores", async () => {
  const w = setup(["Login"], { none: 0.99, "0": 0.01 })
  const reply = await matchBb(w.ports, "thread", "dinosaur")
  expect(reply.ok).toBe(false)
  expect(w.logs).toHaveLength(1)
  expect(w.logs[0]).toMatchObject({ utterance: "dinosaur", outcome: "no-match", method: "semantic", choice: "none", probabilities: { none: 0.99, "0": 0.01 } })
})

test("literal and approximate requests each record one outcome with the matching method", async () => {
  for (const [target, method, outcome] of [["git client", "literal", "requested"], ["get client", "approximate", "choices"]]) {
    const w = setup(["Explore Git clients"])
    await matchBb(w.ports, "thread", target ?? "")
    expect(w.logs).toHaveLength(1)
    expect(w.logs[0]).toMatchObject({ method, outcome, candidateCount: 1 })
  }
})

test("a Jev timeout records one error and does not offer invented matches", async () => {
  const w = setup(["Login"])
  const reply = await matchBb({ ...w.ports, judge: async () => err("Jev timed out") }, "thread", "authentication")
  expect(reply).toMatchObject({ ok: false, outcome: "error" })
  expect(w.logs).toHaveLength(1)
  expect(w.logs[0]).toMatchObject({ outcome: "error", error: "Jev timed out" })
})

test("direct requests log infrastructure failures without claiming completion", async () => {
  const w = setup([])
  const reply = await runBb({ ...w.ports, request: async () => { throw new Error("BB lost focus") } }, { action: "archive" })
  expect(reply).toMatchObject({ ok: false, outcome: "error" })
  expect(w.logs).toHaveLength(1)
  expect(w.logs[0]).toMatchObject({ action: "archive", outcome: "error", message: "BB lost focus" })
})

test("joined ASR words find a spaced thread title without semantic matching", async () => {
  const w = setup(["KB sync and inbox ingest"])
  await matchBb(w.ports, "thread", "kbsync")
  expect(w.commands.at(-1)).toMatchObject({ action: "select", kind: "thread", id: "0" })
  expect(w.judged()).toBe(false)
})

test("joined ASR words offer choices when spaced titles are ambiguous", async () => {
  const w = setup(["KB sync and inbox ingest", "KB sync fixes"])
  await matchBb(w.ports, "thread", "kbsync")
  expect(w.commands.at(-1)).toMatchObject({ action: "choices", options: [{ id: "0" }, { id: "1" }] })
  expect(w.judged()).toBe(false)
})
