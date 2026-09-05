import type { Plugin } from "@opencode-ai/plugin"
import { decide, type Decision } from "../../../src/opencode-plugins/src/policy.ts"

const ASK_SENTINEL = "OPENCODE_POLICY_ASK=1"

function enforce(decision: Decision, args: Record<string, unknown>): void {
  if (decision.kind === "deny") throw new Error(`[${decision.policy}] ${decision.reason}`)
  if (decision.kind === "ask" && typeof args.command === "string") {
    args.command = `${ASK_SENTINEL} ${args.command}`
  }
}

export const SecurityPolicy: Plugin = async () => ({
  "tool.execute.before": async (input, output) => {
    try {
      const name = input.tool.toLowerCase()
      if (name === "bash") {
        if (typeof output.args.command !== "string") throw new Error("[policy_input] Guarded shell call has no command")
        enforce(decide({ kind: "shell", command: output.args.command }), output.args)
      } else if (["read", "edit", "write"].includes(name)) {
        const path = output.args.filePath ?? output.args.path
        if (typeof path !== "string") throw new Error("[policy_input] Guarded file call has no path")
        enforce(decide({ kind: "path", path }), output.args)
      }
    } catch (error) {
      if (error instanceof Error) throw error
      throw new Error("[policy_failure] Security policy failed closed")
    }
  },
})
