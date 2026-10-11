import { expect, test } from "bun:test"
import type { Command, Reply } from "../../../src/bb-plugins/handsfree/contracts.ts"
import { matchBb, parseReply, type BbPorts } from "./bb.ts"
import { ok } from "./pane.ts"

const setup = (labels: string[], probabilities: Record<string, number> = {}) => {
  const commands: Command[] = []
  let judged = false
  const ports: BbPorts = {
    request: async command => {
      commands.push(command)
      return command.action === "list"
        ? { ok: true, message: "", context: "window|thread:project:provider", candidates: labels.map((label, i) => ({ id: String(i), label })) }
        : { ok: true, message: "Selected" }
    },
    judge: async () => { judged = true; return ok({ choice: Object.keys(probabilities)[0] ?? "none", confidence: 0.9, probabilities }) },
    notify: async () => {},
    log: async () => {},
  }
  return { ports, commands, judged: () => judged }
}

test("exact names use the list's window context without calling Jev", async () => {
  const w = setup(["Login", "Billing"])
  await matchBb(w.ports, "thread", "login")
  expect(w.commands[1]).toEqual({ action: "select", kind: "thread", id: "0", context: "window|thread:project:provider" })
  expect(w.judged()).toBe(false)
})

test("ambiguous model families show choices rather than guessing a version", async () => {
  const w = setup(["Claude Sonnet 4.5", "Claude Sonnet 4.6"])
  await matchBb(w.ports, "model", "Sonnet")
  expect(w.commands[1]?.action).toBe("choices")
  expect(w.judged()).toBe(false)
})

test("uncertain semantic matches show numbered candidates", async () => {
  const w = setup(["Login", "Billing"], { "0": 0.55, "1": 0.4, none: 0.05 })
  await matchBb(w.ports, "thread", "authentication bug")
  expect(w.commands[1]?.action).toBe("choices")
})

test("confident semantic matches select a known candidate", async () => {
  const w = setup(["Login", "Billing"], { "0": 0.9, "1": 0.05, none: 0.05 })
  await matchBb(w.ports, "thread", "authentication bug")
  expect(w.commands[1]?.action).toBe("select")
})

test("unknown Jev choices never navigate", async () => {
  const w = setup(["Login"], { invented: 0.99, "0": 0.01 })
  await matchBb(w.ports, "thread", "authentication bug")
  expect(w.commands.some(c => c.action === "select")).toBe(false)
})

test("dotfiles names the live home project", async () => {
  const w = setup(["connorads", "kb"])
  await matchBb(w.ports, "project", "dotfiles")
  expect(w.commands[1]).toMatchObject({ action: "select", kind: "project", id: "0" })
})

test("reply parsing rejects invalid keypresses and candidate records", () => {
  expect(() => parseReply({ ok: true, message: "", press: { key: "x", modifiers: ["invented"] } })).toThrow()
  expect(() => parseReply({ ok: true, message: "", candidates: [{ id: "a" }] })).toThrow()
  const reply: Reply = { ok: true, message: "", press: { key: "Tab", modifiers: ["control"] } }
  expect(parseReply(reply)).toEqual(reply)
})
