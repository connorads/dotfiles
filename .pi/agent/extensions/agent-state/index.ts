// agent-state: bridge pi's lifecycle to the tmux per-pane agent-state helper.
//
// Mirrors the native-hook contract of ~/.config/tmux/scripts/agent-state.sh:
// the helper records state on the agent's pane (resolved from $TMUX_PANE) and
// rolls a per-window option up to the status bar. This extension emits only the
// states an agent owns: working / done / clear. "idle" and "seen" are derived by
// the helper and by tmux focus hooks, never by the agent. pi has no native
// permission event, so there is no `blocked` here.
//
// Constraints honoured:
//   - Quiet no-op outside tmux (TMUX_PANE unset) — registers nothing.
//   - Fire-and-forget: never await, never throw into pi's lifecycle; a status
//     dot must never block or slow the agent.
//   - Only the root interactive (UI) session drives the pane; sub-sessions and
//     print/json runs (ctx.hasUI !== true) are ignored.
//   - Release (clear) only on a real quit. Pi tears down + rebinds extension
//     runtimes for /reload, /new, /resume, /fork — those must NOT release.

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(homedir(), ".config", "tmux", "scripts", "agent-state.sh");
const KIND = "pi";

function inTmux(): boolean {
  const pane = process.env["TMUX_PANE"];
  return typeof pane === "string" && pane.length > 0;
}

// Fire-and-forget. The child inherits TMUX_PANE via env; the helper resolves the
// pane itself. Never awaited; every failure is swallowed so pi is untouched.
function emit(state: "working" | "done" | "clear"): void {
  if (!inTmux()) return;
  try {
    const child = spawn("/bin/sh", [SCRIPT, state, KIND], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.on("error", () => {}); // ENOENT / spawn failure: ignore
    child.unref();
  } catch {
    // never propagate into pi's event loop
  }
}

export default function (pi: ExtensionAPI) {
  if (!inTmux()) return; // outside tmux: do nothing at all

  let active = false; // true once the root interactive session has started
  let agentRunning = false; // guards duplicate/late agent_end events

  pi.on("session_start", (_event, ctx) => {
    // Only the interactive/RPC root session has hasUI === true. Print/json and
    // non-UI sub-sessions are skipped so they cannot flip the pane's dot.
    if (ctx?.hasUI !== true) return;
    active = true;
  });

  pi.on("agent_start", () => {
    if (!active) return;
    agentRunning = true;
    emit("working");
  });

  pi.on("agent_end", () => {
    if (!active) return;
    if (!agentRunning) return; // ignore duplicate/late ends
    agentRunning = false;
    // Helper turns "done" into "idle" if its window is already active; otherwise
    // tmux's focus hook ages done -> idle when you look at the pane.
    emit("done");
  });

  pi.on("session_shutdown", (event) => {
    if (!active) return;
    // Only a genuine quit means the pane's pi process is gone. /reload, /new,
    // /resume and /fork also fire session_shutdown but the pane lives on.
    if (event?.reason === "quit") emit("clear");
  });
}
