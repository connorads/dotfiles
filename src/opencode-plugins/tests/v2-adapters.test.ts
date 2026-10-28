import assert from "node:assert/strict"
import test from "node:test"
import policy from "../../../.config/opencode/plugins-v2/security-policy.ts"

test("V2 policy preserves an existing denial when a command requires review", async () => {
  let evaluate: Parameters<Parameters<typeof policy.setup>[0]["permission"]["hook"]>[1] | undefined
  const cleanup = await policy.setup({ permission: { hook: async (_name, callback) => {
    evaluate = callback
    return { dispose: async () => {} }
  } } })
  assert.ok(evaluate)
  const event = { action: "shell", resources: ["git -c core.hooksPath=/dev/null commit -m example"], effect: "deny" as "allow" | "ask" | "deny" }
  await evaluate(event)
  assert.equal(event.effect, "deny")
  await cleanup()
})

test("V2 policy inspects every shell resource and keeps the strongest decision", async () => {
  let evaluate: Parameters<Parameters<typeof policy.setup>[0]["permission"]["hook"]>[1] | undefined
  await policy.setup({ permission: { hook: async (_name, callback) => {
    evaluate = callback
    return { dispose: async () => {} }
  } } })
  assert.ok(evaluate)
  const event = { action: "shell", resources: ["pwd", "cat ~/.ssh/id_example"], effect: "allow" as "allow" | "ask" | "deny" }
  await evaluate(event)
  assert.equal(event.effect, "deny")
})

for (const resources of [
  ["git -c core.hooksPath=/dev/null commit -m example", "cat ~/.ssh/id_example"],
  ["cat ~/.ssh/id_example", "git -c core.hooksPath=/dev/null commit -m example"],
]) {
  test(`V2 policy keeps denial across resources ${resources.join(" then ")}`, async () => {
    let evaluate: Parameters<Parameters<typeof policy.setup>[0]["permission"]["hook"]>[1] | undefined
    const cleanup = await policy.setup({ permission: { hook: async (_name, callback) => {
      evaluate = callback
      return { dispose: async () => {} }
    } } })
    assert.ok(evaluate)
    const event = { action: "shell", resources, effect: "allow" as "allow" | "ask" | "deny" }
    await evaluate(event)
    assert.equal(event.effect, "deny")
    await cleanup()
  })
}

test("V2 policy blocks a sensitive second file resource", async () => {
  let evaluate: Parameters<Parameters<typeof policy.setup>[0]["permission"]["hook"]>[1] | undefined
  const cleanup = await policy.setup({ permission: { hook: async (_name, callback) => {
    evaluate = callback
    return { dispose: async () => {} }
  } } })
  assert.ok(evaluate)
  const event = { action: "read", resources: ["README.md", "~/.ssh/id_example"], effect: "allow" as "allow" | "ask" | "deny" }
  await evaluate(event)
  assert.equal(event.effect, "deny")
  await cleanup()
})

test("V2 notifications consume event streams and stop on unload", async () => {
  const { default: notifications } = await import("../../../.config/opencode/plugins-v2/bell-notifications.ts")
  let observedSignal: AbortSignal | undefined
  let consumed = false
  let stopped = false
  const cleanup = await notifications.setup({ event: {
    subscribe: async function* ({ signal }) {
      observedSignal = signal
      yield { type: "server.connected" }
      consumed = true
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
      stopped = true
    },
  } })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(consumed, true)
  assert.equal(observedSignal?.aborted, false)
  await cleanup()
  assert.equal(observedSignal?.aborted, true)
  assert.equal(stopped, true)
})
