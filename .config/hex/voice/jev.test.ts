import { describe, expect, test } from "bun:test"
import { parseJevChoice } from "./jev.ts"

describe("parseJevChoice", () => {
  test("reads the named question's answer", () => {
    const r = parseJevChoice({ answers: { thread: { choice: "t1", probabilities: { t1: 0.9 }, confidence: 0.8 } } }, "thread")
    expect(r).toEqual({ ok: true, value: { choice: "t1", probabilities: { t1: 0.9 }, confidence: 0.8 } })
  })

  test("rejects a response without the answer", () => {
    expect(parseJevChoice({ error: "bad key" }, "thread").ok).toBe(false)
    expect(parseJevChoice(null, "thread").ok).toBe(false)
    expect(parseJevChoice({ answers: { thread: { choice: "t1", probabilities: {} } } }, "model").ok).toBe(false)
  })
})
