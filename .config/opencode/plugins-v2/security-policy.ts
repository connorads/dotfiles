import { decide, type Decision } from "../../../src/opencode-plugins/src/policy.ts"

type PermissionEvent = {
  readonly action: string
  readonly resources: readonly string[]
  effect: "allow" | "ask" | "deny"
  message?: string
}

type Registration = { dispose: () => Promise<void> }

export default {
  id: "security-policy",
  setup: async (ctx: { permission: { hook: (name: "evaluate", callback: (event: PermissionEvent) => void | Promise<void>) => Promise<Registration> } }) => {
    const registration = await ctx.permission.hook("evaluate", (event) => {
      if (event.effect === "deny") return
      const action = event.action.toLowerCase()
      if (!["shell", "read", "edit"].includes(action)) return
      let decision: Decision = event.resources.length === 0
        ? { kind: "deny", policy: "policy_input", reason: "Guarded action has no resources" }
        : { kind: "pass" }
      for (const resource of event.resources) {
        const next = action === "shell"
          ? decide({ kind: "shell", command: resource })
          : decide({ kind: "path", path: resource })
        if (next.kind === "deny" || (decision.kind === "pass" && next.kind === "ask")) decision = next
      }
      if (decision.kind === "pass") return
      event.effect = decision.kind
      event.message = `[${decision.policy}] ${decision.reason}`
    })
    return () => registration.dispose()
  },
}
