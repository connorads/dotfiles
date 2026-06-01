// Hand-rolled argv parser → discriminated Command. Pure: no env, no I/O.
//
// Grammar:
//   skl                      → help (the picker is the `skl-pick` shell glue)
//   skl <ref>                → load <ref>          (`load` verb optional)
//   skl load <ref>           → load <ref>
//   skl load --stdin         → load refs read from stdin (one per line)
//   skl list                 → list   (fed to fzf in the pipeline)
//   skl preview <ref>        → preview <ref>   (the fzf preview command)
//   skl --help | -h          → help
// Flags: --target <pane>, --path <dir> (repeatable), --submit, --stdin.

import { ok, err, type Result } from "./result.ts";
import type { ArgError, Command, Options } from "./types.ts";

const VALUE_FLAGS = new Set(["--target", "--path"]);

export const parseArgs = (argv: readonly string[]): Result<Command, ArgError> => {
  let target: string | null = null;
  const paths: string[] = [];
  let submit = false;
  let stdin = false;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";

    if (arg === "--help" || arg === "-h") return ok({ kind: "help" });
    if (arg === "--submit") {
      submit = true;
      continue;
    }
    if (arg === "--stdin") {
      stdin = true;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) return err({ kind: "missing-value", flag: arg });
      if (arg === "--target") target = value;
      else paths.push(value);
      i++;
      continue;
    }
    if (arg.startsWith("-")) return err({ kind: "unknown-flag", flag: arg });
    positionals.push(arg);
  }

  const options: Options = { target, paths, submit };

  if (positionals[0] === "list") {
    if (positionals.length > 1) return err({ kind: "too-many-args", args: positionals.slice(1) });
    return ok({ kind: "list", options });
  }

  if (positionals[0] === "preview") {
    if (positionals.length !== 2) return err({ kind: "too-many-args", args: positionals });
    return ok({ kind: "preview", ref: positionals[1] ?? "", options });
  }

  // Everything else is a load. The `load` verb is optional, so strip a leading
  // one; what remains is the (single) ref, unless `--stdin` supplies the refs.
  const refArgs = positionals[0] === "load" ? positionals.slice(1) : positionals;

  if (stdin) {
    if (refArgs.length > 0) return err({ kind: "too-many-args", args: refArgs });
    return ok({ kind: "load", ref: null, options });
  }

  if (refArgs.length === 0) return ok({ kind: "help" });
  if (refArgs.length > 1) return err({ kind: "too-many-args", args: refArgs.slice(1) });
  return ok({ kind: "load", ref: refArgs[0] ?? "", options });
};
