import type { Plugin } from "@opencode-ai/plugin"
import type { Event } from "@opencode-ai/sdk"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

// Bridges opencode's session lifecycle to the tmux per-pane agent-state helper
// (~/.config/tmux/scripts/agent-state.sh). The helper resolves the target pane
// from $AGENT_STATE_PANE or $TMUX_PANE; opencode runs inside a tmux pane, so a
// spawned shell inherits TMUX_PANE and lands on the right pane. The plugin emits
// only the four states the helper expects from an agent: working | blocked |
// done | clear. "idle"/"seen" demotion is owned by the helper and tmux hooks.
//
// tool.execute.before/after and chat.message are top-level plugin hook keys
// (invoked via plugin trigger), NOT event-bus types — the rest arrive through
// the `event` hook. Subagent (task tool) sessions carry a parentID; their
// lifecycle events are dropped so a finished subagent can't fake the pane idle.

type AgentState = "working" | "blocked" | "done" | "clear"

const CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
const SCRIPT = join(CONFIG_HOME, "tmux", "scripts", "agent-state.sh")
const KIND = "opencode"

export const AgentStatePlugin: Plugin = async () => {
  // Outside tmux there is nothing to drive: register no hooks at all.
  if (!process.env.TMUX_PANE) return {}

  const childSessions = new Set<string>()
  // Spawning a shell on every tool call is wasteful, so only fire on a real
  // change. `clear` always fires (teardown is idempotent and rare).
  let lastState: AgentState | undefined

  const emit = (state: AgentState): void => {
    if (state !== "clear" && state === lastState) return
    lastState = state
    try {
      spawn("sh", [SCRIPT, state, KIND], { stdio: "ignore", detached: true }).unref()
    } catch {
      // A status dot must never propagate failure into opencode.
    }
  }

  const isChild = (sessionID: unknown): boolean =>
    typeof sessionID === "string" && childSessions.has(sessionID)

  return {
    // Top-level hooks (plugin trigger, not the event bus): the turn/tool
    // critical path, our most reliable "working" signal.
    "chat.message": async (input: { sessionID?: string }) => {
      if (isChild(input?.sessionID)) return
      emit("working")
    },
    "tool.execute.before": async (input: { sessionID?: string }) => {
      if (isChild(input?.sessionID)) return
      emit("working")
    },
    "tool.execute.after": async (input: { sessionID?: string }) => {
      if (isChild(input?.sessionID)) return
      emit("working")
    },

    event: async ({ event }: { event: Event }) => {
      const properties = (event?.properties ?? {}) as {
        sessionID?: string
        info?: { id?: string; parentID?: string }
      }

      // Learn child sessions before dropping their events.
      const info = properties.info
      if (info?.id && info.parentID) childSessions.add(info.id)
      if (isChild(properties.sessionID)) return

      switch (event.type) {
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
        case "session.compacted":
          emit("working")
          break
        case "permission.asked":
        case "question.asked":
        case "session.error":
          emit("blocked")
          break
        case "session.idle":
          emit("done")
          break
        case "session.deleted":
        case "global.disposed":
          emit("clear")
          break
        default:
          break
      }
    },
  }
}
