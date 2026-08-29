// argv into a tagged command. Pure, so the whole surface is testable without
// a store, a tmux server or an editor.

import { isSourceKind, type SourceKind } from "./excerpt.ts";
import { err, ok, type Result } from "./result.ts";

export const DESTINATION_KINDS = ["agent", "clipboard", "file"] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

const isDestinationKind = (value: string): value is DestinationKind =>
  (DESTINATION_KINDS as readonly string[]).includes(value);

export interface StashCommand {
  readonly kind: "stash";
  readonly source: SourceKind;
  readonly pane: string | null;
  readonly cwd: string | null;
  readonly session: string | null;
  readonly entry: string | null;
}

export interface SendCommand {
  readonly kind: "send";
  readonly to: string | null;
  readonly destination: DestinationKind;
  /** Where a `file` destination writes. */
  readonly file: string | null;
  readonly edit: boolean;
  readonly dryRun: boolean;
}

export interface DraftCommand {
  readonly kind: "draft";
  readonly action: "show" | "edit" | "discard";
}

export interface DropCommand {
  readonly kind: "drop";
  /** A 1-based index, the newest excerpt, or every excerpt. */
  readonly target: { readonly kind: "index"; readonly index: number } | { readonly kind: "last" } | { readonly kind: "all" };
}

export interface EntriesCommand {
  readonly kind: "entries";
  readonly json: boolean;
  readonly pane: string | null;
}

export type Command =
  | StashCommand
  | EntriesCommand
  | SendCommand
  | DraftCommand
  | DropCommand
  | { readonly kind: "list"; readonly json: boolean }
  | { readonly kind: "clear" }
  | { readonly kind: "undo" }
  | { readonly kind: "render" }
  | { readonly kind: "count" }
  | { readonly kind: "path" }
  | { readonly kind: "help" };

export const USAGE = `annotate - batch corrections from terminal output into one agent prompt

  annotate stash [--source selection|pane|transcript] [--pane %N] [--cwd DIR]
                 [--session NAME] [--entry UUID]      text on stdin
  annotate list [--json]          excerpts waiting to be sent
  annotate drop <n|last|all>      remove one, the newest, or every excerpt
  annotate clear                  empty the spool
  annotate send [--to %N] [--dest agent|clipboard|file] [--file PATH]
                [--no-edit] [--dry-run]
  annotate draft [--edit|--discard]   show, reopen, or bin the draft
  annotate undo                   restore the draft the last send delivered
  annotate entries [--pane %N] [--json]   transcript messages to stash from
  annotate render                 print what a fresh draft would look like
  annotate count                  excerpts waiting, for the status pill
  annotate path                   the event log's path

In the editor: save and quit to send. To keep comments without sending, save
then exit non-zero (vim's :w then :cq); an unchanged draft is never sent.

exit: 0 ok · 1 store failure · 2 usage · 3 unresolvable · 4 refused · 5 stall`;

const wants = (argv: readonly string[], i: number, flag: string): Result<string, string> => {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("-")) return err(`${flag} needs a value`);
  return ok(value);
};

const parseStash = (argv: readonly string[]): Result<Command, string> => {
  let source: SourceKind = "selection";
  let pane: string | null = null;
  let cwd: string | null = null;
  let session: string | null = null;
  let entry: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    switch (arg) {
      case "--source": {
        const value = wants(argv, i, arg);
        if (!value.ok) return value;
        if (!isSourceKind(value.value)) return err(`unknown source: ${value.value}`);
        source = value.value;
        i += 1;
        break;
      }
      case "--pane":
      case "--cwd":
      case "--session":
      case "--entry": {
        const value = wants(argv, i, arg);
        if (!value.ok) return value;
        if (arg === "--pane") pane = value.value;
        else if (arg === "--cwd") cwd = value.value;
        else if (arg === "--session") session = value.value;
        else entry = value.value;
        i += 1;
        break;
      }
      default:
        return err(`unknown argument: ${arg}`);
    }
  }
  return ok({ kind: "stash", source, pane, cwd, session, entry });
};

const parseSend = (argv: readonly string[]): Result<Command, string> => {
  let to: string | null = null;
  let destination: DestinationKind = "agent";
  let file: string | null = null;
  let edit = true;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    switch (arg) {
      case "--to":
      case "--dest":
      case "--file": {
        const value = wants(argv, i, arg);
        if (!value.ok) return value;
        if (arg === "--to") to = value.value;
        else if (arg === "--file") file = value.value;
        else {
          if (!isDestinationKind(value.value)) return err(`unknown destination: ${value.value}`);
          destination = value.value;
        }
        i += 1;
        break;
      }
      case "--no-edit":
        edit = false;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      default:
        return err(`unknown argument: ${arg}`);
    }
  }
  // `--file` names a destination as plainly as `--dest file` does; taking it
  // as one saves the caller spelling both.
  if (file !== null && destination === "agent") destination = "file";
  return ok({ kind: "send", to, destination, file, edit, dryRun });
};

const parseDraft = (argv: readonly string[]): Result<Command, string> => {
  if (argv.length === 0) return ok({ kind: "draft", action: "show" });
  if (argv.length > 1) return err(`unknown argument: ${argv[1] as string}`);
  const flag = argv[0] as string;
  if (flag === "--edit") return ok({ kind: "draft", action: "edit" });
  if (flag === "--discard") return ok({ kind: "draft", action: "discard" });
  return err(`unknown argument: ${flag}`);
};

const parseEntries = (argv: readonly string[]): Result<Command, string> => {
  let json = false;
  let pane: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--json") json = true;
    else if (arg === "--pane") {
      const value = wants(argv, i, arg);
      if (!value.ok) return value;
      pane = value.value;
      i += 1;
    } else return err(`unknown argument: ${arg}`);
  }
  return ok({ kind: "entries", json, pane });
};

const parseDrop = (argv: readonly string[]): Result<Command, string> => {
  const target = argv[0];
  if (target === undefined) return err("drop needs <n|last|all>");
  if (argv.length > 1) return err(`unknown argument: ${argv[1] as string}`);
  if (target === "last") return ok({ kind: "drop", target: { kind: "last" } });
  if (target === "all") return ok({ kind: "drop", target: { kind: "all" } });
  const index = Number(target);
  if (!Number.isInteger(index) || index < 1) return err(`not an excerpt number: ${target}`);
  return ok({ kind: "drop", target: { kind: "index", index } });
};

const parseList = (argv: readonly string[]): Result<Command, string> => {
  let json = false;
  for (const arg of argv) {
    if (arg === "--json") json = true;
    else return err(`unknown argument: ${arg}`);
  }
  return ok({ kind: "list", json });
};

const bare = (argv: readonly string[], command: Command): Result<Command, string> =>
  argv.length === 0 ? ok(command) : err(`unknown argument: ${argv[0] as string}`);

export const parseArgs = (argv: readonly string[]): Result<Command, string> => {
  const [head, ...rest] = argv;
  if (head === undefined) return ok({ kind: "help" });
  switch (head) {
    case "stash":
      return parseStash(rest);
    case "list":
      return parseList(rest);
    case "entries":
      return parseEntries(rest);
    case "drop":
      return parseDrop(rest);
    case "send":
      return parseSend(rest);
    case "draft":
      return parseDraft(rest);
    case "clear":
      return bare(rest, { kind: "clear" });
    case "undo":
      return bare(rest, { kind: "undo" });
    case "render":
      return bare(rest, { kind: "render" });
    case "count":
      return bare(rest, { kind: "count" });
    case "path":
      return bare(rest, { kind: "path" });
    case "help":
    case "--help":
    case "-h":
      return ok({ kind: "help" });
    default:
      return err(`unknown command: ${head}`);
  }
};
