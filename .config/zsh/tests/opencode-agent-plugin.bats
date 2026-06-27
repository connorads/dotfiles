#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

# Guards the opencode agent-tracking plugin (phase 3). Behavioural: the REAL
# plugin is imported and its hooks/events are driven against a throwaway tmux
# server, asserting the per-pane @agent_state it produces. Covers the state
# mapping, the child-session drop (a finished sub-agent must not fake idle), and
# the no-op-outside-tmux guard.
PLUGIN="$HOME/.config/opencode/plugin/agent-state.ts"
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  BUN_BIN="$(command -v bun || true)"
  [ -n "$BUN_BIN" ] || skip "bun not installed"
  [ -f "$PLUGIN" ] || skip "no opencode agent-state plugin"
  SOCK="ocplugin_${BATS_TEST_NUMBER}_$$"
  tx new-session -d -s s -x 80 -y 24
  PANE=$(tx display-message -p -t s '#{pane_id}') # first window's pane...
  tx new-window -t s                              # ...now inactive, so done stays done
  TMUX_ENV="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  DRIVER="$BATS_TEST_TMPDIR/driver.mjs"
  cat >"$DRIVER" <<'JS'
import { execFileSync } from "node:child_process"
const { TX_BIN, TX_SOCK, PANE, PLUGIN, TMUX_ENV, MODE } = process.env
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const st = () => {
  try {
    return execFileSync(TX_BIN, ["-L", TX_SOCK, "show-options", "-pqv", "-t", PANE, "@agent_state"]).toString().trim() || "unset"
  } catch {
    return "err"
  }
}
process.env.TMUX = TMUX_ENV
if (MODE === "noop") {
  delete process.env.TMUX_PANE
  const { AgentStatePlugin } = await import(PLUGIN)
  const h = await AgentStatePlugin({})
  console.log("keys=" + Object.keys(h).length)
  console.log("state=" + st())
} else {
  process.env.TMUX_PANE = PANE
  const { AgentStatePlugin } = await import(PLUGIN)
  const h = await AgentStatePlugin({})
  const ev = (type, properties = {}) => h.event({ event: { type, properties } })
  const step = async (label, fn) => { await fn(); await sleep(220); console.log(label + "=" + st()) }
  await step("chat.message", () => h["chat.message"]({ sessionID: "root" }))
  await step("permission.asked", () => ev("permission.asked", { sessionID: "root" }))
  await step("permission.replied", () => ev("permission.replied", { sessionID: "root" }))
  h.event({ event: { type: "session.updated", properties: { info: { id: "child", parentID: "root" } } } })
  await step("child.idle", () => ev("session.idle", { sessionID: "child" }))
  await step("root.idle", () => ev("session.idle", { sessionID: "root" }))
  await step("deleted", () => ev("session.deleted", { sessionID: "root" }))
}
JS
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

drive() {
  run env TX_BIN="$TMUX_BIN" TX_SOCK="$SOCK" PANE="$PANE" PLUGIN="$PLUGIN" \
    TMUX_ENV="$TMUX_ENV" MODE="$1" "$BUN_BIN" "$DRIVER"
  [ "$status" -eq 0 ]
}

@test "drives working/blocked/done/clear and drops child-session idle" {
  drive lifecycle
  [[ "$output" == *"chat.message=working"* ]]
  [[ "$output" == *"permission.asked=blocked"* ]]
  [[ "$output" == *"permission.replied=working"* ]]
  [[ "$output" == *"child.idle=working"* ]] # child idle dropped -> still working
  [[ "$output" == *"root.idle=done"* ]]
  [[ "$output" == *"deleted=unset"* ]]
}

@test "registers no hooks and never touches tmux when TMUX_PANE is unset" {
  drive noop
  [[ "$output" == *"keys=0"* ]]
  [[ "$output" == *"state=unset"* ]]
}
