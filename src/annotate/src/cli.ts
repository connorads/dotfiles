// The imperative shell: the only place that reads argv, touches the store,
// writes to stdout, or catches. Everything it decides is decided in core.

import { parseArgs, USAGE, type Command } from "./core/args.ts";
import { captureExcerpt } from "./core/excerpt.ts";
import { exitCodeFor, isFailure, type Outcome } from "./core/exit.ts";
import { isoTimestamp } from "./core/ids.ts";
import { formatList, listRows, renderDraft } from "./core/render.ts";
import { dropTargets, spoolJson } from "./core/spool.ts";
import { readEnv, type Env } from "./shell/env.ts";
import { openSource } from "./shell/sources/index.ts";
import { appendEvent, readState, withLock } from "./shell/store.ts";

const readStdin = async (): Promise<string> => {
  if (process.stdin.isTTY === true) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

const out = (text: string): void => {
  if (text.length > 0) process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const runStash = async (command: Extract<Command, { kind: "stash" }>, env: Env): Promise<Outcome> => {
  const capture = await openSource({
    kind: command.source,
    stdin: await readStdin(),
    pane: command.pane,
    cwd: command.cwd,
    session: command.session,
    entry: command.entry,
  });
  if (!capture.ok) {
    if (capture.error.kind === "empty") return { kind: "ok", message: "annotate: nothing selected" };
    return { kind: "unresolvable", message: `annotate: ${capture.error.message}` };
  }

  const now = Date.now();
  const excerpt = captureExcerpt(capture.value.text, capture.value.origin, {
    now,
    random: Math.random(),
  });
  if (!excerpt.ok) {
    // An empty selection is the commonest way to press the key by accident.
    // Saying so and exiting 0 keeps the capture key silent-on-success and
    // harmless-on-mistake.
    if (excerpt.error.kind === "empty") return { kind: "ok", message: "annotate: nothing selected" };
    return {
      kind: "usage",
      message: `annotate: excerpt is ${Math.round(excerpt.error.bytes / 1024)} KiB, over the ${Math.round(
        excerpt.error.limit / 1024,
      )} KiB limit`,
    };
  }

  return withLock(env.logPath, async () => {
    const appended = await appendEvent(env.logPath, {
      kind: "stashed",
      ts: isoTimestamp(now),
      excerpt: excerpt.value,
    });
    if (!appended.ok) return { kind: "store", message: `annotate: ${appended.error.message}` };
    const state = await readState(env.logPath);
    const count = state.ok ? state.value.spool.length : 0;
    return { kind: "ok", message: `annotate: stashed ${count}` };
  });
};

const runList = async (json: boolean, env: Env): Promise<Outcome> => {
  const state = await readState(env.logPath);
  if (!state.ok) return { kind: "store", message: `annotate: ${state.error.message}` };
  if (json) return { kind: "ok", message: spoolJson(state.value.spool) };
  if (state.value.spool.length === 0) return { kind: "ok", message: "annotate: nothing stashed" };
  return { kind: "ok", message: formatList(listRows(state.value.spool, env.home)) };
};

const runRender = async (env: Env): Promise<Outcome> => {
  const state = await readState(env.logPath);
  if (!state.ok) return { kind: "store", message: `annotate: ${state.error.message}` };
  if (state.value.spool.length === 0) return { kind: "ok", message: "annotate: nothing stashed" };
  return { kind: "ok", message: renderDraft(state.value.spool, env.home) };
};

const runDrop = async (command: Extract<Command, { kind: "drop" }>, env: Env): Promise<Outcome> =>
  withLock(env.logPath, async () => {
    const state = await readState(env.logPath);
    if (!state.ok) return { kind: "store", message: `annotate: ${state.error.message}` };
    const targets = dropTargets(state.value.spool, command.target);
    if (!targets.ok) return { kind: "ok", message: `annotate: ${targets.error}` };
    const ts = isoTimestamp(Date.now());
    for (const excerptId of targets.value) {
      const appended = await appendEvent(env.logPath, { kind: "dropped", ts, excerptId });
      if (!appended.ok) return { kind: "store", message: `annotate: ${appended.error.message}` };
    }
    const left = state.value.spool.length - targets.value.length;
    return { kind: "ok", message: `annotate: dropped ${targets.value.length}, ${left} left` };
  });

const runCount = async (env: Env): Promise<Outcome> => {
  const state = await readState(env.logPath);
  // The status pill calls this every tick. A store it cannot read means "no
  // pill", not an error on the status line.
  if (!state.ok) return { kind: "ok", message: "0" };
  return { kind: "ok", message: String(state.value.spool.length) };
};

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const run = async (command: Command, env: Env): Promise<Outcome> => {
  switch (command.kind) {
    case "help":
      return { kind: "ok", message: USAGE };
    case "path":
      return { kind: "ok", message: env.logPath };
    case "stash":
      return runStash(command, env);
    case "list":
      return runList(command.json, env);
    case "render":
      return runRender(env);
    case "drop":
      return runDrop(command, env);
    case "clear":
      return runDrop({ kind: "drop", target: { kind: "all" } }, env);
    case "count":
      return runCount(env);
  }
};

const main = async (): Promise<number> => {
  const command = parseArgs(process.argv.slice(2));
  if (!command.ok) {
    process.stderr.write(`annotate: ${command.error}\n\n${USAGE}\n`);
    return exitCodeFor({ kind: "usage", message: command.error });
  }

  let outcome: Outcome;
  try {
    outcome = await run(command.value, readEnv());
  } catch (cause) {
    outcome = {
      kind: "store",
      message: `annotate: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const message = outcome.message ?? "";
  if (isFailure(outcome)) process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  else out(message);
  return exitCodeFor(outcome);
};

process.exitCode = await main();
