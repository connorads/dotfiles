import { defineHexConfig } from "@hex/commands"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

const BB = "/Users/connorads/.local/bin/bb"
const KEY_CODES: Record<string, number> = {
  escape: 53, enter: 36, tab: 48,
  arrowup: 126, arrowdown: 125, arrowleft: 123, arrowright: 124,
  home: 115, end: 119, pageup: 116, pagedown: 121,
}

type Press = { key: string; modifiers: string[] }

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim()

const press = async ({ key, modifiers }: Press) => {
  const using = modifiers.map(modifier => `${modifier} down`).join(", ")
  const code = KEY_CODES[key]
  const stroke = code === undefined ? `keystroke "${key}"` : `key code ${code}`
  await run("/usr/bin/osascript", ["-e", `tell application "System Events" to ${stroke}${using ? ` using {${using}}` : ""}`])
}

export default defineHexConfig({
  transformations: {
    "bb-commands": {
      name: "BB voice commands",
      description: "Saying only \"next thread\" moves to the next BB thread; other dictation pastes unchanged",
      timeout: 10000,
      transform: async text => {
        if (normalise(text) !== "next thread") return text
        try {
          const { stdout } = await run(BB, ["handsfree", "command", JSON.stringify({ action: "next" })])
          const reply = JSON.parse(stdout)
          if (reply.ok && reply.press) await press(reply.press)
          else console.log(`bb-commands: ${reply.message}`)
        } catch (error) {
          console.log(`bb-commands: ${error instanceof Error ? error.message : String(error)}`)
        }
        return ""
      },
    },
  },
})
