import { writeFile } from "node:fs/promises"

type Event = { readonly type?: string }

export default {
  id: "bell-notifications",
  setup: async (ctx: { event: { subscribe: (callback: (event: Event) => void | Promise<void>) => void } }) => {
    ctx.event.subscribe(async (event) => {
      if (!["session.idle", "session.error", "permission.asked", "question.asked"].includes(event.type ?? "")) return
      try { await writeFile("/dev/tty", "\u0007") } catch { /* Notification failure is advisory. */ }
    })
  },
}
