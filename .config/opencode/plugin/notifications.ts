import type { Plugin } from "@opencode-ai/plugin"
import type {
  Event,
  EventSessionCreated,
  EventSessionUpdated,
  EventSessionIdle,
  EventSessionError,
} from "@opencode-ai/sdk"

type MacOSSound =
  | "Basso"
  | "Blow"
  | "Bottle"
  | "Frog"
  | "Funk"
  | "Glass"
  | "Hero"
  | "Morse"
  | "Ping"
  | "Pop"
  | "Purr"
  | "Sosumi"
  | "Submarine"
  | "Tink"

type SessionEvent =
  | EventSessionCreated
  | EventSessionUpdated
  | EventSessionIdle
  | EventSessionError

const isSessionEvent = (event: Event): event is SessionEvent =>
  event.type === "session.created" ||
  event.type === "session.updated" ||
  event.type === "session.idle" ||
  event.type === "session.error"

export const NotificationPlugin: Plugin = async ({ $, client }) => {
  const sessionTitles = new Map<string, string>()

  const formatSessionLabel = (sessionID: string | undefined): string => {
    if (!sessionID) {
      return "Unknown session"
    }

    const title = sessionTitles.get(sessionID)
    if (!title) {
      return `Session ${sessionID.slice(0, 8)}`
    }

    return `${title} (${sessionID.slice(0, 8)})`
  }

  const escapePowerShell = (value: string): string =>
    String(value).replace(/'/g, "''")

  const notify = async (
    title: string,
    message: string,
    sound: MacOSSound = "Glass"
  ): Promise<void> => {
    try {
      if (process.platform === "darwin") {
        const script = [
          "on run argv",
          "display notification (item 1 of argv) with title (item 2 of argv) sound name (item 3 of argv)",
          "end run",
        ].join("\n")
        await $`osascript -e ${script} ${message} ${title} ${sound}`
        return
      }

      if (process.platform === "linux") {
        await $`notify-send ${title} ${message}`
        return
      }

      if (process.platform === "win32") {
        const script = [
          "$module = Get-Module -ListAvailable -Name BurntToast",
          "if ($null -ne $module) {",
          `  New-BurntToastNotification -Text '${escapePowerShell(title)}', '${escapePowerShell(message)}'`,
          "}",
        ].join(" ")
        await $`powershell -NoProfile -Command ${script}`
      }
    } catch (error) {
      await client.app.log({
        body: {
          service: "opencode-notify",
          level: "warn",
          message: "Notification failed",
          extra: { error: String(error) },
        },
      })
    }
  }

  return {
    event: async ({ event }) => {
      if (!isSessionEvent(event)) {
        return
      }

      if (event.type === "session.created" || event.type === "session.updated") {
        const { id, title } = event.properties.info
        sessionTitles.set(id, title)
        return
      }

      if (event.type === "session.idle") {
        const label = formatSessionLabel(event.properties.sessionID)
        await notify("OpenCode", `Session completed: ${label}`)
        return
      }

      if (event.type === "session.error") {
        const label = formatSessionLabel(event.properties.sessionID)
        await notify("OpenCode", `Session error: ${label}`, "Basso")
      }
    },
  }
}
