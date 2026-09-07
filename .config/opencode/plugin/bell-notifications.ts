import type { Plugin } from "@opencode-ai/plugin"
import type { Event as EventV1 } from "@opencode-ai/sdk"
import type { Event as EventV2 } from "@opencode-ai/sdk/v2/types"
import { writeFile } from "node:fs/promises"

// `session.idle` is v1-only and `permission.asked`/`question.asked` are v2-only,
// so the ring set spans both of opencode's event surfaces and the parameter is
// the union of the two. See plugin/agent-state.ts for the same reasoning.
const shouldRing = (event: EventV1 | EventV2): boolean => {
  switch (event.type) {
    case "session.idle":
    case "session.error":
    case "permission.asked":
    case "question.asked":
      return true
    default:
      return false
  }
}

export const BellNotifications: Plugin = async ({ client }) => {
  const ringBell = async (): Promise<void> => {
    try {
      await writeFile("/dev/tty", "\u0007")
    } catch (error) {
      await client.app.log({
        body: {
          service: "opencode-bell",
          level: "warn",
          message: "Bell notification failed",
          extra: { error: String(error) },
        },
      })
    }
  }

  return {
    event: async ({ event }) => {
      if (!shouldRing(event)) {
        return
      }

      await ringBell()
    },
  }
}
