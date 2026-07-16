// Gated pipeline integration test: proves the real shell pipeline the popup
// uses — `skl list | skl load --stdin --target PANE` — discovers, resolves and
// injects pointers into a live pane. fzf sits in the middle in production, but
// it only forwards selected lines verbatim, so piping `skl list` straight into
// `skl load --stdin` exercises the exact list⇄load contract with no TTY needed.
// (This is why dropping the Bun-spawned fzf made the tool testable; see ADR-0004.)
//
// Target is `cat` (raw reader: no bracketed paste, no line editing), so injected
// bytes appear verbatim. No-Enter check: the pointer's un-terminated final line
// would appear twice if we had pressed C-m.
//
// NOTE: tmux needs its server socket; run unsandboxed (the unix-socket connect
// is blocked otherwise) — `/sandbox` or dangerouslyDisableSandbox.

import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { capturePane } from "../src/shell/tmux.ts";

const tmuxAvailable = (): boolean => {
  try {
    return Bun.spawnSync(["tmux", "start-server"]).exitCode === 0;
  } catch {
    return false;
  }
};

const CLI = resolve(import.meta.dir, "../src/cli.ts");
const REPO = resolve(import.meta.dir, "fixtures/repo");
const SESSION = `skl-pipe-itest-${process.pid}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let pane = "";

describe.if(tmuxAvailable())("skl list | skl load --stdin (real tmux)", () => {
  beforeAll(async () => {
    const out = Bun.spawnSync([
      "tmux", "new-session", "-d", "-s", SESSION,
      "-x", "200", "-y", "50", "-P", "-F", "#{pane_id}", "cat",
    ]);
    pane = out.stdout.toString().trim();
    await sleep(150);
  });

  afterAll(async () => {
    await Bun.spawn(["tmux", "kill-session", "-t", SESSION], { stderr: "ignore" }).exited;
  });

  test("lists all fixture skills, then injects each selected pointer", async () => {
    // Stage 1: `skl list` — one `ref  description` line per discovered skill.
    const list = Bun.spawnSync([process.execPath, CLI, "list", "--path", REPO]);
    expect(list.exitCode).toBe(0);
    const lines = list.stdout.toString().trim().split("\n");
    const refs = lines.map((l) => l.split(/\s+/)[0]).sort();
    expect(refs).toEqual(["repo/alpha", "repo/beta", "repo/noname"]);

    // Stage 2: pipe two of those lines into `skl load --stdin` → real injection.
    const selected = lines.filter((l) => /^repo\/(alpha|beta)\b/.test(l)).join("\n");
    // Divert usage-history logging so the test never pollutes the real
    // ~/.local/state/skl/history.jsonl with fixture loads.
    const historyFile = join(mkdtempSync(join(tmpdir(), "skl-pipe-hist-")), "history.jsonl");
    const load = Bun.spawnSync(
      [process.execPath, CLI, "load", "--stdin", "--target", pane, "--path", REPO],
      {
        stdin: new TextEncoder().encode(selected),
        env: { ...process.env, SKL_HISTORY_FILE: historyFile },
      },
    );
    expect(load.exitCode).toBe(0);
    await sleep(200);

    const captured = await capturePane(pane);
    // Both pointers landed: visible skill name + the bulk's source tag, verbatim.
    expect(captured).toContain("alpha");
    expect(captured).toContain("(skl: repo/alpha)");
    expect(captured).toContain("beta");
    expect(captured).toContain("(skl: repo/beta)");
    // No Enter: each pointer's un-terminated final instruction line appears once.
    expect(captured.split("and follow it.").length - 1).toBe(2);
  });
});
