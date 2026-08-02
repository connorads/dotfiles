// Gated tmux integration test: proves the injection mechanism delivers the
// visible name + bulk verbatim into a real pane, and does NOT press Enter.
//
// Target is `cat` (a raw reader: no bracketed-paste, no line editing). The pane
// id is captured from `new-session -P -F` rather than hardcoding `:0.0`, because
// the user's tmux uses base-index 1 (so window 0 does not exist).
//
// No-Enter check: the bulk's final line has no trailing newline, so `cat` leaves
// it un-flushed and it appears exactly once. Had we pressed Enter (C-m), cat
// would receive the terminator and re-emit that line → it would appear twice.
//
// NOTE: tmux needs its server socket; run unsandboxed (the unix-socket connect
// is blocked otherwise) — `/sandbox` or dangerouslyDisableSandbox.

import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { copyToClipboard, injectPointer, capturePane } from "../src/shell/tmux.ts";
import type { Pointer } from "../src/core/types.ts";

// Gate on actually being able to reach a tmux server (start-server needs the
// unix socket). This both skips when tmux is absent AND when the socket is
// blocked (e.g. a sandboxed test run) — the latter is not a real failure.
const tmuxAvailable = (): boolean => {
  try {
    return Bun.spawnSync(["tmux", "start-server"]).exitCode === 0;
  } catch {
    return false;
  }
};

const SESSION = `skl-itest-${process.pid}`;
let pane = "";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const FINAL = "done `q` ; $HOME"; // no trailing newline in the bulk

describe.if(tmuxAvailable())("injectPointer (real tmux)", () => {
  beforeAll(async () => {
    const out = Bun.spawnSync([
      "tmux", "new-session", "-d", "-s", SESSION,
      "-x", "200", "-y", "50", "-P", "-F", "#{pane_id}", "cat",
    ]);
    pane = out.stdout.toString().trim();
    await sleep(150);
  });

  afterAll(async () => {
    await Bun.spawn(["tmux", "kill-session", "-t", SESSION]).exited;
  });

  test("delivers visible name + multiline bulk verbatim, no Enter", async () => {
    const pointer: Pointer = {
      skillName: "alpha",
      bulk: ["(skl: repo/alpha)", "/repo/alpha", "├── SKILL.md", "└── refs", FINAL].join("\n"),
    };

    const result = await injectPointer(pane, pointer, { submit: false });
    expect(result.ok).toBe(true);
    await sleep(200);

    const captured = await capturePane(pane);
    // Visible literal name + bulk bytes survived verbatim (newlines, backticks,
    // ;, $HOME, unicode glyphs) — no shell interpretation.
    expect(captured).toContain("alpha");
    expect(captured).toContain("(skl: repo/alpha)");
    expect(captured).toContain("├── SKILL.md");
    expect(captured).toContain(FINAL);
    // No Enter: the un-terminated final line appears exactly once.
    expect(captured.split(FINAL).length - 1).toBe(1);
  });
});

// The OSC52 write itself needs an attached terminal to observe; what we can
// prove against a real server is that the payload landed verbatim in the named
// tmux buffer. Address it by the returned name — this may run against a LIVE
// server, and bare show-buffer/delete-buffer act on the user's automatic-buffer
// stack, not our named buffer (that mistake ate real yanks once).
describe.if(tmuxAvailable())("copyToClipboard (real tmux)", () => {
  test("payload lands verbatim in a named tmux buffer", async () => {
    const text = `alpha (skl: repo/alpha)\n├── SKILL.md\n${FINAL}`;

    const result = await copyToClipboard(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const shown = Bun.spawnSync(["tmux", "show-buffer", "-b", result.value]).stdout.toString();
    expect(shown).toBe(text);

    Bun.spawnSync(["tmux", "delete-buffer", "-b", result.value]);
  });
});
