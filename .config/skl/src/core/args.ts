// Hand-rolled argv parser → discriminated Command. Pure: no env, no I/O.
//
// Grammar:
//   skl                      → pick
//   skl <ref>                → load <ref>
//   skl list                 → list
//   skl preview <ref>        → preview <ref>   (internal; used by the fzf preview)
//   skl --help | -h          → help
// Flags: --target <pane>, --path <dir> (repeatable), --submit.

import { ok, err, type Result } from "./result.ts";
import type { ArgError, Command, Options } from "./types.ts";

const VALUE_FLAGS = new Set(["--target", "--path"]);

export const parseArgs = (argv: readonly string[]): Result<Command, ArgError> => {
  let target: string | null = null;
  const paths: string[] = [];
  let submit = false;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";

    if (arg === "--help" || arg === "-h") return ok({ kind: "help" });
    if (arg === "--submit") {
      submit = true;
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

  if (positionals.length === 0) return ok({ kind: "pick", options });

  const [first, ...rest] = positionals;

  if (first === "list") {
    if (rest.length > 0) return err({ kind: "too-many-args", args: rest });
    return ok({ kind: "list", options });
  }

  if (first === "preview") {
    if (rest.length !== 1) return err({ kind: "too-many-args", args: positionals });
    return ok({ kind: "preview", ref: rest[0] ?? "", options });
  }

  if (positionals.length > 1) return err({ kind: "too-many-args", args: rest });
  return ok({ kind: "load", ref: first ?? "", options });
};
