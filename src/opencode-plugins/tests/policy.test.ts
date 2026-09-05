import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { decide, type Decision, type Request } from "../src/policy.ts"

type Case = { readonly name: string; readonly request: Request; readonly decision: Decision["kind"]; readonly policy?: string }
const cases = JSON.parse(await readFile(new URL("../fixtures/policy-cases.json", import.meta.url), "utf8")) as Case[]

for (const item of cases) {
  test(item.name, () => {
    const actual = decide(item.request)
    assert.equal(actual.kind, item.decision)
    if (item.policy !== undefined && actual.kind !== "pass") assert.equal(actual.policy, item.policy)
  })
}
