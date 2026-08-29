// argv into a tagged command. Pure, so the whole surface is testable without
// a store, a tmux server or an editor.

import { isSourceKind, type SourceKind } from "./excerpt.ts";
import { err, ok, type Result } from "./result.ts";

export interface StashCommand {
  readonly kind: "stash";
  readonly source: SourceKind;
  readonly pane: string | null;
  readonly cwd: string | null;
  readonly session: string | null;
  readonly entry: string | null;
}

export interface DropCommand {
  readonly kind: "drop";
  /** A 1-based index, the newest excerpt, or every excerpt. */
  readonly target: { readonly kind: "index"; readonly index: number } | { readonly kind: "last" } | { readonly kind: "all" };
}

export type Command =
  | StashCommand
  | DropCommand
  | { readonly kind: "list"; readonly json: boolean }
  | { readonly kind: "clear" }
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
  annotate render                 print what a fresh draft would look like
  annotate count                  excerpts waiting, for the status pill
  annotate path                   the event log's path

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
    case "drop":
      return parseDrop(rest);
    case "clear":
      return bare(rest, { kind: "clear" });
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
