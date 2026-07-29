#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

# Guards the pi agent-tracking extension (phase 3). Behavioural: the REAL
# extension is imported and its lifecycle handlers are driven against a throwaway
# tmux server, asserting the per-pane @agent_state. Covers working/done, the
# release-only-on-quit rule (/reload must not clear), the hasUI gate (print/json
# sessions are ignored), and the no-op-outside-tmux guard. pi has no native
# permission event, so there is intentionally no blocked state.
EXT="$HOME/.pi/agent/extensions/agent-state/index.ts"
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  BUN_BIN="$(command -v bun || true)"
  [ -n "$BUN_BIN" ] || skip "bun not installed"
  [ -f "$EXT" ] || skip "no pi agent-state extension"
  SOCK="piext_${BATS_TEST_NUMBER}_$$"
  # -f /dev/null: bare server (see AGENTS.md) so the extension's own state writes,
  # not the real config's focus hooks, are what set the pane option we assert on.
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
  PANE=$(tx display-message -p -t s '#{pane_id}') # first window's pane...
  tx new-window -t s                              # ...now inactive, so done stays done
  TMUX_ENV="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  DRIVER="$BATS_TEST_TMPDIR/driver.mjs"
  cat >"$DRIVER" <<'JS'
import { execFileSync } from "node:child_process"
const { TX_BIN, TX_SOCK, PANE, EXT, TMUX_ENV, MODE } = process.env
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const st = () => {
  try {
    return execFileSync(TX_BIN, ["-L", TX_SOCK, "show-options", "-pqv", "-t", PANE, "@agent_state"]).toString().trim() || "unset"
  } catch {
    return "err"
  }
}
const load = () => {
  const handlers = {}
  return import(EXT).then((mod) => { mod.default({ on: (e, h) => { handlers[e] = h } }); return handlers })
}
process.env.TMUX = TMUX_ENV
if (MODE === "noop") {
  delete process.env.TMUX_PANE
  const handlers = await load()
  console.log("handlers=" + Object.keys(handlers).length)
  console.log("state=" + st())
} else if (MODE === "nonui") {
  process.env.TMUX_PANE = PANE
  const handlers = await load()
  handlers["session_start"]({}, { hasUI: false })
  handlers["agent_start"]({}, {})
  // A settle, not a poll: the claim is that nothing writes the dot, and only
  // elapsed time can falsify that.
  await sleep(300)
  console.log("state=" + st())
} else {
  process.env.TMUX_PANE = PANE
  const handlers = await load()
  const CHANGE_BUDGET_MS = 5000
  // Poll until the dot changes, rather than sleeping a guess at how long the
  // write takes. The handler writes with a detached `tmux set-option` and the
  // read-back is another fork, so "has it landed?" is an observable, not a
  // duration - and a duration tuned on an idle machine is not long enough under
  // the parallel runner.
  const stepChange = async (label, fn) => {
    const before = st()
    await fn()
    const deadline = Date.now() + CHANGE_BUDGET_MS
    let now = before
    while (Date.now() < deadline) {
      now = st()
      if (now !== before) break
      await sleep(50)
    }
    console.log(label + "=" + now)
  }
  // A step that must NOT change the dot keeps a fixed settle: there is no event
  // to wait for, so the only way to catch a spurious write is to leave time for
  // one to happen.
  const stepSettle = async (label, fn) => { await fn(); await sleep(300); console.log(label + "=" + st()) }
  handlers["session_start"]({}, { hasUI: true })
  await stepChange("agent_start", () => handlers["agent_start"]({}, {}))
  await stepChange("agent_end", () => handlers["agent_end"]({}, {}))
  await stepSettle("shutdown_reload", () => handlers["session_shutdown"]({ reason: "reload" })) // /reload must not clear
  await stepChange("shutdown_quit", () => handlers["session_shutdown"]({ reason: "quit" }))
}
JS
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

drive() {
  run env TX_BIN="$TMUX_BIN" TX_SOCK="$SOCK" PANE="$PANE" EXT="$EXT" \
    TMUX_ENV="$TMUX_ENV" MODE="$1" "$BUN_BIN" "$DRIVER"
  [ "$status" -eq 0 ]
}

@test "agent_start->working, agent_end->done, releases only on quit" {
  drive lifecycle
  [[ "$output" == *"agent_start=working"* ]]
  [[ "$output" == *"agent_end=done"* ]]
  [[ "$output" == *"shutdown_reload=done"* ]] # /reload must not clear
  [[ "$output" == *"shutdown_quit=unset"* ]]
}

@test "ignores non-UI (print/json) sessions" {
  drive nonui
  [[ "$output" == *"state=unset"* ]]
}

@test "registers nothing when TMUX_PANE is unset" {
  drive noop
  [[ "$output" == *"handlers=0"* ]]
  [[ "$output" == *"state=unset"* ]]
}
