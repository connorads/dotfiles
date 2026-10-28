import { writeFile } from "node:fs/promises"

type Event = { readonly type: string }

export default {
  id: "bell-notifications",
  setup: async (ctx: { event: { subscribe: (options: { signal: AbortSignal }) => AsyncIterable<Event> } }) => {
    const controller = new AbortController()
    const listening = (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (!["session.execution.succeeded", "session.execution.failed", "permission.asked", "form.created"].includes(event.type)) continue
        try { await writeFile("/dev/tty", "\u0007") } catch { /* Notification failure is advisory. */ }
      }
    })().catch(() => { /* Notification failure is advisory. */ })
    return async () => {
      controller.abort()
      await listening
    }
  },
}
