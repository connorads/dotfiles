import type { Plugin } from "@opencode-ai/plugin"
import type { Event } from "@opencode-ai/sdk"

const shouldRing = (event: Event): boolean => {
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

export const BellNotifications: Plugin = async ({ $, client }) => {
  const ringBell = async (): Promise<void> => {
    try {
      await $`printf '\\a' > /dev/tty`
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
