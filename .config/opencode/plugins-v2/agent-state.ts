import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

type Event = { readonly type?: string }

export default {
  id: "agent-state",
  setup: async (ctx: { event: { subscribe: (callback: (event: Event) => void) => void }; tool: { hook: (name: "execute.before", callback: () => void) => void } }) => {
    if (!process.env.TMUX_PANE) return
    const script = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "tmux", "scripts", "agent-state.sh")
    const emit = (state: "working" | "blocked" | "done" | "clear"): void => {
      try { spawn("sh", [script, state, "opencode"], { stdio: "ignore", detached: true }).unref() } catch { /* Status is advisory. */ }
    }
    ctx.tool.hook("execute.before", () => emit("working"))
    ctx.event.subscribe((event) => {
      if (event.type === "session.idle") emit("done")
      else if (["permission.asked", "question.asked", "session.error"].includes(event.type ?? "")) emit("blocked")
      else if (event.type === "global.disposed") emit("clear")
    })
  },
}
