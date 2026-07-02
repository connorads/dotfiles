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
// the `event` hook.
//
// Subagents (Task tool) run as child sessions carrying info.parentID, learned
// from session.created/updated. Their *busy* activity is forwarded to the pane
// so a running subagent keeps the dot working; their *idle* is suppressed so a
// finished subagent can't demote the pane (the original "fake the pane idle"
// hazard). The dot only goes `done` once the ROOT session is itself idle AND no
// tracked child is still busy — a deferred done so a prematurely-idle root
// (e.g. opencode parking the parent while a foreground subagent drains) can't
// age the dot out from under in-flight work.

type AgentState = "working" | "blocked" | "done" | "clear"

const CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
const SCRIPT = join(CONFIG_HOME, "tmux", "scripts", "agent-state.sh")
const KIND = "opencode"

export const AgentStatePlugin: Plugin = async () => {
  // Outside tmux there is nothing to drive: register no hooks at all.
  if (!process.env.TMUX_PANE) return {}

  // childSessions: every session whose parentID we have seen (learned from
  //   session.created/updated). status events carry only sessionID, so this set
  //   is how we tell a subagent idle from the root session going quiet.
  // childBusy: child sessions whose last session.status was busy/retry. The
  //   deferred-done gate: the pane is only `done` once the root is idle AND this
  //   set is empty (no subagent still in flight).
  // rootIdle: last known root status. False until the root reports idle.
  // lastState: dedup so an unchanged re-emit doesn't respawn the helper; also
  //   guards `working` from demoting a live `blocked` (a subagent's tool pings
  //   must not cancel the root's permission prompt).
  const childSessions = new Set<string>()
  const childBusy = new Set<string>()
  let rootIdle = false
  let lastState: AgentState | undefined

  const run = (state: AgentState): void => {
    lastState = state
    try {
      spawn("sh", [SCRIPT, state, KIND], { stdio: "ignore", detached: true }).unref()
    } catch {
      // A status dot must never propagate failure into opencode.
    }
  }

  // emit: dedup + the working-doesn't-demote-blocked rule. blocked/done/clear
  // always proceed (escalation, or a genuine finish). To leave `blocked` past
  // the guard, call run() directly (see permission.replied).
  const emit = (state: AgentState): void => {
    if (state === lastState) return
    if (state === "working" && lastState === "blocked") return
    run(state)
  }

  const isChild = (sessionID: unknown): boolean =>
    typeof sessionID === "string" && childSessions.has(sessionID)

  // A pinpoint of activity. For a child we record the busy slot so the
  // deferred-done gate keeps the dot up while it (or any sibling) drains; for
  // the root we clear rootIdle (a fresh user/tool action means the root is no
  // longer quiet). Never invert: a child going busy must NOT clear rootIdle —
  // only the root's own status owns that flag, else a background subagent's idle
  // could never retire the dot.
  const markBusy = (sessionID: string): void => {
    if (childSessions.has(sessionID)) {
      childBusy.add(sessionID)
    } else {
      rootIdle = false
    }
    emit("working")
  }

  // A session went idle. The ROOT going idle is the finish signal — gated behind
  // childBusy so a parked-while-subagent-runs root can't age the dot out. A
  // CHILD going idle never demotes by itself; if it was the last in-flight
  // subagent and the root is already idle, the deferred done fires here.
  const handleIdle = (sessionID: string): void => {
    if (childSessions.has(sessionID)) {
      const wasBusy = childBusy.delete(sessionID)
      if (wasBusy && rootIdle && childBusy.size === 0) emit("done")
      return
    }
    rootIdle = true
    if (childBusy.size === 0) emit("done")
    else emit("working") // root quieted but a subagent is still draining → re-assert
  }

  return {
    // Top-level hooks (plugin trigger, not the event bus): the turn/tool
    // critical path, our most reliable "working" signal. Now NOT gated to the
    // root — a subagent's own tool calls/message flow ping the pane busy too.
    "chat.message": async (input: { sessionID?: string }) => {
      markBusy(input?.sessionID ?? "")
    },
    "tool.execute.before": async (input: { sessionID?: string }) => {
      markBusy(input?.sessionID ?? "")
    },
    "tool.execute.after": async (input: { sessionID?: string }) => {
      markBusy(input?.sessionID ?? "")
    },

    event: async ({ event }: { event: Event }) => {
      const properties = (event?.properties ?? {}) as {
        sessionID?: string
        status?: { type: "busy" | "idle" | "retry" }
        info?: { id?: string; parentID?: string }
      }

      // Learn child sessions before deciding on their events. session.created
      // /updated carry info (with parentID); status/idle events carry only
      // sessionID, so this lookup is the child/root discriminator.
      const info = properties.info
      if (info?.id && info.parentID) childSessions.add(info.id)
      const sid = properties.sessionID ?? info?.id ?? ""

      switch (event.type) {
        // session.status is the authoritative lifecycle event; session.idle is
        // its deprecated predecessor (both are published). Route both through
        // the same idle/busy handling so the plugin works across versions.
        case "session.status": {
          const st = properties.status?.type
          if (st === "busy" || st === "retry") {
            markBusy(sid)
          } else if (st === "idle") {
            handleIdle(sid)
          }
          break
        }
        case "session.idle":
          handleIdle(sid)
          break
        case "session.compacted":
          emit("working")
          break
        // Blocked state belongs to the root pane's own prompts. A subagent's
        // permission ask or error is surfaced by its parent (it stays working);
        // forwarding blocked from children caused spurious bell rings.
        case "permission.updated":
        case "permission.asked":
        case "session.error":
          if (isChild(sid)) break
          emit("blocked")
          break
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
          if (isChild(sid)) break
          run("working") // leave blocked once the prompt is resolved
          break
        // Real teardown only when the root (or the whole instance) is torn down;
        // a deleted subagent just retires its busy slot, never clears the pane.
        // Discriminate via the learned childSessions set (same as everywhere
        // else), not the delete payload — the event need not carry parentID.
        case "session.deleted":
        case "global.disposed":
          if (isChild(sid)) {
            childSessions.delete(sid)
            handleIdle(sid)
            break
          }
          childSessions.delete(sid)
          childBusy.delete(sid)
          run("clear")
          break
        default:
          break
      }
    },
  }
}
