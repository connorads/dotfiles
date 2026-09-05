import { decide } from "../../../src/opencode-plugins/src/policy.ts"

type PermissionEvent = {
  readonly action?: string
  readonly resources?: readonly string[]
  effect?: "allow" | "ask" | "deny"
  message?: string
}

export default {
  id: "security-policy",
  setup: async (ctx: { permission: { hook: (name: "evaluate", callback: (event: PermissionEvent) => void | Promise<void>) => void } }) => {
    ctx.permission.hook("evaluate", (event) => {
      const action = event.action?.toLowerCase()
      let decision
      if (action === "shell") {
        const command = event.resources?.[0]
        decision = typeof command === "string"
          ? decide({ kind: "shell", command })
          : { kind: "deny" as const, policy: "policy_input", reason: "Guarded shell call has no command" }
      } else if (["read", "edit", "write"].includes(action ?? "")) {
        const path = event.resources?.[0]
        decision = typeof path === "string"
          ? decide({ kind: "path", path })
          : { kind: "deny" as const, policy: "policy_input", reason: "Guarded file call has no path" }
      } else return
      if (decision.kind === "pass") return
      event.effect = decision.kind
      event.message = `[${decision.policy}] ${decision.reason}`
    })
  },
}
