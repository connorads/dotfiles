#!/usr/bin/env bun
// SHELL: argv → load config/glob/read → core → tmux/fzf → exit code.
// Exceptions are caught only here; the core returns explicit Result values.

import { parseArgs } from "./core/args.ts";
import { parseConfig, configFromPaths } from "./core/config.ts";
import { parseRef } from "./core/ref.ts";
import { resolveRef, resolveRefs } from "./core/resolve.ts";
import { renderPointer } from "./core/pointer.ts";
import { skillRef, skillsToLines, linesToRefs } from "./core/display.ts";
import type {
  ArgError,
  Config,
  ConfigError,
  DiscoveredSkill,
  Options,
  ResolveError,
} from "./core/types.ts";
import type { Result } from "./core/result.ts";
import { env } from "./shell/env.ts";
import { loadConfigFile, discoverAll, type ConfigFileError } from "./shell/fs.ts";
import { injectPointer, resolveTarget } from "./shell/tmux.ts";

const HELP = `skl — deliberate agent-skill loader for tmux

The picker is the \`skl-pick\` shell glue (bound to tmux prefix + A), which
composes this CLI with fzf:

  skl list | fzf --multi --preview 'skl preview {1}' | skl load --stdin --target <pane>

Usage:
  skl <name>                resolve by config precedence, inject pointer
  skl <source>/<name>       inject the exact skill copy
  skl --stdin               inject pointers for refs read from stdin
  skl list                  list discovered skills (fed to fzf)
  skl preview <ref>         render a skill's pointer (the fzf preview)
  skl --help                show this help

Options:
  --target <pane>           tmux pane to inject into (default: last-active)
  --path <dir>              override config sources entirely (repeatable)
  --submit                  press Enter after injecting (default: never)
`;

const DEFAULT_CONFIG = `${import.meta.dir}/../config.json`;

const fmtArgError = (e: ArgError): string => {
  switch (e.kind) {
    case "missing-value":
      return `missing value for ${e.flag}`;
    case "unknown-flag":
      return `unknown flag ${e.flag}`;
    case "too-many-args":
      return `too many arguments: ${e.args.join(" ")}`;
  }
};

const fmtConfigError = (e: ConfigError): string => {
  switch (e.kind) {
    case "not-object":
      return "config is not a JSON object";
    case "paths-not-array":
      return "config.paths must be an array";
    case "empty":
      return "config.paths is empty — add at least one source";
    case "path-not-object":
      return `config.paths[${e.index}] is not an object`;
    case "path-missing":
      return `config.paths[${e.index}] is missing a string "path"`;
    case "name-not-string":
      return `config.paths[${e.index}].name must be a string`;
  }
};

const fmtConfigFileError = (e: ConfigFileError): string => {
  switch (e.kind) {
    case "missing":
      return `no config at ${e.path} — create one or pass --path <dir>`;
    case "parse":
      return `config at ${e.path} is not valid JSON: ${e.message}`;
  }
};

const fmtResolveError = (e: ResolveError): string => {
  switch (e.kind) {
    case "not-found":
      return `no skill named "${e.name}"`;
    case "source-unknown":
      return `unknown source "${e.source}"`;
  }
};

// Pointers must carry absolute paths (the agent reads SKILL.md from its own
// cwd). Tilde/$HOME stay for the core to expand; a bare relative path is
// resolved against this process's cwd here, at the boundary.
const absolutise = (p: string): string =>
  p.startsWith("/") || p.startsWith("~") || p.startsWith("$HOME")
    ? p
    : `${process.cwd()}/${p}`;

const buildConfig = async (
  options: Options,
): Promise<Result<Config, string>> => {
  const home = env.home();
  if (options.paths.length > 0) {
    return { ok: true, value: configFromPaths(options.paths.map(absolutise), home) };
  }
  const loaded = await loadConfigFile(DEFAULT_CONFIG);
  if (!loaded.ok) return { ok: false, error: fmtConfigFileError(loaded.error) };
  const parsed = parseConfig(loaded.value, home);
  if (!parsed.ok) return { ok: false, error: fmtConfigError(parsed.error) };
  return { ok: true, value: parsed.value };
};

// Inject pointers for one or more refs into a single target pane. The target is
// resolved once (so stacked skills land in the same pane); all refs resolve
// before any injection, so a bad ref fails the batch with no partial injection.
const loadRefs = async (
  refs: readonly string[],
  skills: readonly DiscoveredSkill[],
  options: Options,
): Promise<number> => {
  if (refs.length === 0) return 0; // nothing selected (e.g. fzf cancelled)

  const target = await resolveTarget(options.target);
  if (!target.ok) {
    env.stderr(`skl: ${target.error.stderr || target.error.command}\n`);
    return 1;
  }

  // Resolve the whole batch up front (pure) — bail before injecting anything.
  const resolved = resolveRefs(refs, skills);
  if (!resolved.ok) {
    env.stderr(`skl: ${fmtResolveError(resolved.error)}\n`);
    return 1;
  }

  for (const skill of resolved.value) {
    const injected = await injectPointer(target.value, renderPointer(skill), {
      submit: options.submit,
    });
    if (!injected.ok) {
      env.stderr(`skl: ${injected.error.stderr || injected.error.command}\n`);
      return 1;
    }
    // Visibility of system status: print the resolved source/name.
    env.stdout(`skl: loaded ${skillRef(skill)} → ${target.value}\n`);
  }
  return 0;
};

const main = async (argv: readonly string[]): Promise<number> => {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    env.stderr(`skl: ${fmtArgError(parsed.error)}\n\n${HELP}`);
    return 2;
  }
  const command = parsed.value;

  if (command.kind === "help") {
    env.stdout(HELP);
    return 0;
  }

  const config = await buildConfig(command.options);
  if (!config.ok) {
    env.stderr(`skl: ${config.error}\n`);
    return 1;
  }
  const skills = await discoverAll(config.value.sources);

  switch (command.kind) {
    case "list": {
      for (const line of skillsToLines(skills)) env.stdout(`${line}\n`);
      return 0;
    }
    case "preview": {
      const resolved = resolveRef(parseRef(command.ref), skills);
      if (!resolved.ok) {
        env.stderr(`skl: ${fmtResolveError(resolved.error)}\n`);
        return 1;
      }
      const pointer = renderPointer(resolved.value);
      env.stdout(`${pointer.skillName}\n\n${pointer.bulk}\n`);
      return 0;
    }
    case "load": {
      // `--stdin` (command.ref === null) reads the picker's selected lines and
      // parses the ref out of each; otherwise it's the single positional ref.
      const refs = command.ref === null
        ? linesToRefs((await env.stdin()).split("\n"))
        : [command.ref];
      return loadRefs(refs, skills, command.options);
    }
  }
};

try {
  process.exit(await main(env.argv()));
} catch (e) {
  env.stderr(`skl: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
