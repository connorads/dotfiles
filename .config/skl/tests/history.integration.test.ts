// Usage-history integration tests. The no-tmux half proves `skl history` reads
// the file named by SKL_HISTORY_FILE (the test seam) and prints sorted counts.
// The gated half proves the real pipeline — `skl list | skl load --stdin` into
// a live pane — appends one valid JSONL record per injected skill. The copy
// path is deliberately not exercised end-to-end: it would clobber the user's
// clipboard (tmux load-buffer -w / OSC52).
//
// NOTE: the tmux half needs the server socket; run unsandboxed (the
// unix-socket connect is blocked otherwise) — `/sandbox` or
// dangerouslyDisableSandbox.

import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli.ts");
const REPO = resolve(import.meta.dir, "fixtures/repo");

const runHistory = (file: string) =>
  Bun.spawnSync([process.execPath, CLI, "history"], {
    env: { ...process.env, SKL_HISTORY_FILE: file },
  });

describe("skl history (seeded file)", () => {
  const dir = mkdtempSync(join(tmpdir(), "skl-history-"));

  test("prints per-skill counts, most-loaded first", async () => {
    const file = join(dir, "history.jsonl");
    const rec = (source: string, name: string, ts: string): string =>
      JSON.stringify({ schema_version: 1, ts, source, name, mode: "inject", target: "%1", submit: false });
    await Bun.write(file, [
      rec("vendor", "grilling", "2026-07-01T10:00:00.000Z"),
      rec("mine", "tdd", "2026-07-02T10:00:00.000Z"),
      rec("vendor", "grilling", "2026-07-16T10:00:00.000Z"),
      "not json — must be skipped, not fatal",
      "",
    ].join("\n"));

    const out = runHistory(file);
    expect(out.exitCode).toBe(0);
    expect(out.stdout.toString().trimEnd().split("\n")).toEqual([
      "2  vendor/grilling  last 2026-07-16",
      "1  mine/tdd  last 2026-07-02",
    ]);
  });

  test("missing file → friendly one-liner, exit 0", () => {
    const out = runHistory(join(dir, "does-not-exist.jsonl"));
    expect(out.exitCode).toBe(0);
    expect(out.stdout.toString()).toContain("no usage history yet");
  });
});

const tmuxAvailable = (): boolean => {
  try {
    return Bun.spawnSync(["tmux", "start-server"]).exitCode === 0;
  } catch {
    return false;
  }
};

const SESSION = `skl-hist-itest-${process.pid}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let pane = "";

describe.if(tmuxAvailable())("history logging via skl list | skl load --stdin (real tmux)", () => {
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

  test("a successful injection appends one valid record", async () => {
    // Points into a fresh temp dir with no file yet, so this also proves the
    // adapter creates the parent path on first append.
    const file = join(mkdtempSync(join(tmpdir(), "skl-history-tmux-")), "state", "history.jsonl");

    const list = Bun.spawnSync([process.execPath, CLI, "list", "--path", REPO]);
    const selected = list.stdout.toString().trim().split("\n")
      .filter((l) => /^repo\/alpha\b/.test(l))
      .join("\n");
    const load = Bun.spawnSync(
      [process.execPath, CLI, "load", "--stdin", "--target", pane, "--path", REPO],
      {
        stdin: new TextEncoder().encode(selected),
        env: { ...process.env, SKL_HISTORY_FILE: file },
      },
    );
    expect(load.exitCode).toBe(0);
    expect(load.stderr.toString()).toBe("");

    const lines = (await Bun.file(file).text()).trimEnd().split("\n");
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      schema_version: 1,
      source: "repo",
      name: "alpha",
      mode: "inject",
      target: pane,
      submit: false,
    });
  });
});
