// tmux adapter — the risky bit. Every call is argv-form Bun.spawn (no shell
// strings); the bulk payload travels via stdin (no argv/quoting), so arbitrary
// bytes (newlines, quotes, $, ;, backticks, unicode) survive verbatim.
//
// Per skill:
//   send-keys  -t PANE -l "NAME "                  visible literal name + space
//   load-buffer -b skl-<uniq> -   < BULK           bulk via stdin → unique buffer
//   paste-buffer -t PANE -b skl-<uniq> -p -d       -p bracketed paste, -d cleanup
//   (--submit only)  send-keys -t PANE C-m
//
// -p makes the agent CLI collapse the paste to "[Pasted text +N lines]" and
// suppresses newline-submit; the unique buffer name avoids races when stacking.

import { ok, err, type Result } from "../core/result.ts";
import type { Pointer } from "../core/types.ts";

export interface TmuxError {
  readonly kind: "tmux-failed";
  readonly command: string;
  readonly stderr: string;
}

export interface InjectOptions {
  readonly submit: boolean;
}

let injectionCounter = 0;
const uniqueBufferName = (): string => `skl-${process.pid}-${injectionCounter++}`;

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const runTmux = async (args: readonly string[], stdin?: string): Promise<RunResult> => {
  const proc = Bun.spawn(["tmux", ...args], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
};

const step = async (
  args: readonly string[],
  stdin?: string,
): Promise<Result<RunResult, TmuxError>> => {
  const r = await runTmux(args, stdin);
  if (r.code !== 0) {
    return err({ kind: "tmux-failed", command: `tmux ${args.join(" ")}`, stderr: r.stderr.trim() });
  }
  return ok(r);
};

/** Resolve the injection target: explicit --target wins, else last-active pane. */
export const resolveTarget = async (
  explicit: string | null,
): Promise<Result<string, TmuxError>> => {
  if (explicit !== null) return ok(explicit);
  const r = await step(["display-message", "-p", "-t", "{last}", "#{pane_id}"]);
  if (!r.ok) return r;
  const paneId = r.value.stdout.trim();
  if (paneId.length === 0) {
    return err({ kind: "tmux-failed", command: "display-message {last}", stderr: "no last-active pane" });
  }
  return ok(paneId);
};

export const injectPointer = async (
  paneId: string,
  pointer: Pointer,
  options: InjectOptions,
): Promise<Result<void, TmuxError>> => {
  const buffer = uniqueBufferName();

  const name = await step(["send-keys", "-t", paneId, "-l", `${pointer.skillName} `]);
  if (!name.ok) return name;

  const load = await step(["load-buffer", "-b", buffer, "-"], pointer.bulk);
  if (!load.ok) return load;

  const paste = await step(["paste-buffer", "-t", paneId, "-b", buffer, "-p", "-d"]);
  if (!paste.ok) return paste;

  if (options.submit) {
    const submit = await step(["send-keys", "-t", paneId, "C-m"]);
    if (!submit.ok) return submit;
  }

  return ok(undefined);
};

/** Test helper: capture a pane's visible contents. */
export const capturePane = async (target: string): Promise<string> => {
  const r = await runTmux(["capture-pane", "-p", "-t", target]);
  return r.stdout;
};
