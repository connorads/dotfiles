// The imperative shell: the only place that reads argv, touches the store,
// writes to stdout, or catches. Everything it decides is decided in core.

import { parseArgs, USAGE, type Command } from "./core/args.ts";
import { describeProblem, readyToSend } from "./core/draft.ts";
import { captureExcerpt } from "./core/excerpt.ts";
import { exitCodeFor, isFailure, type Outcome } from "./core/exit.ts";
import { isoTimestamp } from "./core/ids.ts";
import { formatList, listRows, renderDraft, updateDraft } from "./core/render.ts";
import { dropTargets, resolveTarget, spoolJson } from "./core/spool.ts";
import { pickerRows } from "./core/transcript.ts";
import { deliver } from "./shell/destinations/index.ts";
import { edit } from "./shell/editor.ts";
import { readEnv, type Env } from "./shell/env.ts";
import { openSource } from "./shell/sources/index.ts";
import { transcriptFor } from "./shell/sources/transcript.ts";
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
    readStdin,
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

/**
 * The transcript turns a pane can be quoted from. Feeds the picker, which
 * takes the uuid in field 1 and hides it with `--with-nth=2..`.
 */
const runEntries = async (
  command: Extract<Command, { kind: "entries" }>,
  env: Env,
): Promise<Outcome> => {
  const pane = command.pane ?? env.tmuxPane;
  if (pane === null) {
    return { kind: "usage", message: "annotate: entries needs --pane %N" };
  }
  const read = await transcriptFor(pane);
  if (!read.ok) {
    if (read.error.kind === "empty") return { kind: "ok" };
    return { kind: "unresolvable", message: `annotate: ${read.error.message}` };
  }
  if (command.json) {
    return { kind: "ok", message: JSON.stringify(read.value.transcript.entries, null, 2) };
  }
  return { kind: "ok", message: pickerRows(read.value.transcript).join("\n") };
};

// ---------------------------------------------------------------------------
// Draft and send
// ---------------------------------------------------------------------------

/** Persist the draft. Its own event, so an interrupted editor loses nothing. */
const saveDraft = async (
  env: Env,
  markdown: string,
  renderedThrough: string | null,
): Promise<Outcome | null> => {
  const appended = await appendEvent(env.logPath, {
    kind: "drafted",
    ts: isoTimestamp(Date.now()),
    markdown,
    renderedThrough,
  });
  return appended.ok ? null : { kind: "store", message: `annotate: ${appended.error.message}` };
};

const runSend = async (command: Extract<Command, { kind: "send" }>, env: Env): Promise<Outcome> => {
  const state = await readState(env.logPath);
  if (!state.ok) return { kind: "store", message: `annotate: ${state.error.message}` };

  // One path for both cases: render the spool if there is no draft, otherwise
  // append whatever was stashed since the draft was last rendered. Comments
  // already written are never touched.
  const update = updateDraft(
    state.value.spool,
    state.value.draft,
    state.value.renderedThrough,
    env.home,
  );
  if (update.markdown.trim().length === 0) return { kind: "ok", message: "annotate: nothing to send" };

  if (update.added > 0 || state.value.draft === null) {
    const failed = await saveDraft(env, update.markdown, update.renderedThrough);
    if (failed !== null) return failed;
  }

  let markdown = update.markdown;
  if (command.edit) {
    const outcome = await edit(markdown, env.editor);
    switch (outcome.kind) {
      case "failed":
        return { kind: "unresolvable", message: `annotate: ${outcome.message}` };
      case "aborted":
      case "unchanged": {
        // Keep whatever reached the file; deliver nothing. Quitting the editor
        // must never fire an unreviewed draft at an agent.
        const failed = await saveDraft(env, outcome.markdown, update.renderedThrough);
        if (failed !== null) return failed;
        return {
          kind: "ok",
          message:
            outcome.kind === "aborted"
              ? "annotate: draft kept, nothing sent"
              : "annotate: draft unchanged, nothing sent",
        };
      }
      case "edited":
        markdown = outcome.markdown;
        break;
    }
    const failed = await saveDraft(env, markdown, update.renderedThrough);
    if (failed !== null) return failed;
  }

  const ready = readyToSend(markdown);
  if (!ready.ok) {
    const message = `annotate: ${describeProblem(ready.error)}`;
    // An empty draft is a clean cancel - deleting every section is how you
    // change your mind. Over the cap is a mistake worth naming.
    return ready.error.kind === "empty"
      ? { kind: "ok", message }
      : { kind: "usage", message };
  }

  const choice = resolveTarget(state.value.spool, command.to);
  const pane = choice.kind === "none" ? null : choice.pane;
  if (choice.kind === "mostRecent") {
    process.stderr.write(
      `annotate: excerpts came from ${choice.panes.join(", ")}; sending to ${choice.pane}\n`,
    );
  }

  if (command.dryRun) {
    const where = command.destination === "agent" ? `${command.destination}:${pane ?? "?"}` : command.destination;
    return { kind: "ok", message: `${ready.value}\n\n--- would send to ${where} ---` };
  }

  const delivered = await deliver({
    kind: command.destination,
    markdown: ready.value,
    pane,
    file: command.file,
  });
  if (!delivered.ok) {
    // Nothing is cleared: `sent` is appended only after a success, so the
    // spool and the draft are exactly where they were.
    return { kind: delivered.error.kind, message: `annotate: ${delivered.error.message}` };
  }

  const appended = await appendEvent(env.logPath, {
    kind: "sent",
    ts: isoTimestamp(Date.now()),
    markdown: ready.value,
    destination: delivered.value.destination,
    excerptIds: state.value.spool.map((e) => e.id),
  });
  if (!appended.ok) return { kind: "store", message: `annotate: ${appended.error.message}` };
  return { kind: "ok", message: `annotate: sent to ${delivered.value.destination}` };
};

const runDraft = async (command: Extract<Command, { kind: "draft" }>, env: Env): Promise<Outcome> => {
  const state = await readState(env.logPath);
  if (!state.ok) return { kind: "store", message: `annotate: ${state.error.message}` };

  if (command.action === "discard") {
    if (state.value.draft === null) return { kind: "ok", message: "annotate: no draft" };
    const failed = await saveDraft(env, "", null);
    return failed ?? { kind: "ok", message: "annotate: draft discarded" };
  }

  const update = updateDraft(
    state.value.spool,
    state.value.draft,
    state.value.renderedThrough,
    env.home,
  );
  if (update.markdown.trim().length === 0) return { kind: "ok", message: "annotate: no draft" };

  if (command.action === "show") return { kind: "ok", message: update.markdown };

  // `--edit` is the any-editor route to "write comments now, send later": no
  // delivery happens whatever the editor exits with.
  const outcome = await edit(update.markdown, env.editor);
  if (outcome.kind === "failed") {
    return { kind: "unresolvable", message: `annotate: ${outcome.message}` };
  }
  const failed = await saveDraft(env, outcome.markdown, update.renderedThrough);
  return failed ?? { kind: "ok", message: "annotate: draft saved" };
};

const runUndo = async (env: Env): Promise<Outcome> => {
  const state = await readState(env.logPath);
  if (!state.ok) return { kind: "store", message: `annotate: ${state.error.message}` };
  const last = state.value.lastSent;
  if (last === null) return { kind: "ok", message: "annotate: nothing sent yet" };

  // An append, not a rewind: the history stays a record of what happened. The
  // spool is not restored - the draft is what carries the writing, so a
  // mis-targeted send is `undo` then `send --to %N` with nothing retyped.
  const failed = await saveDraft(env, last.markdown, state.value.renderedThrough);
  return failed ?? { kind: "ok", message: `annotate: restored the draft sent to ${last.destination}` };
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
    case "send":
      return runSend(command, env);
    case "draft":
      return runDraft(command, env);
    case "undo":
      return runUndo(env);
    case "entries":
      return runEntries(command, env);
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
