import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

type Event = { readonly type: string }

export default {
  id: "agent-state",
  setup: async (ctx: { event: { subscribe: (options: { signal: AbortSignal }) => AsyncIterable<Event> } }) => {
    if (!process.env.TMUX_PANE) return
    const script = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "tmux", "scripts", "agent-state.sh")
    const emit = (state: "working" | "blocked" | "done" | "clear"): void => {
      try { spawn("sh", [script, state, "opencode"], { stdio: "ignore", detached: true }).unref() } catch { /* Status is advisory. */ }
    }
    const controller = new AbortController()
    const listening = (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type === "session.execution.started") emit("working")
        else if (event.type === "session.execution.succeeded") emit("done")
        else if (["permission.asked", "form.created", "session.execution.failed"].includes(event.type)) emit("blocked")
        else if (event.type === "session.execution.interrupted") emit("clear")
      }
    })().catch(() => { /* Status is advisory. */ })
    return async () => {
      controller.abort()
      await listening
      emit("clear")
    }
  },
}
