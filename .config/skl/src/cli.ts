#!/usr/bin/env bun
// SHELL: argv → load config/glob/read → core → tmux/fzf → exit code.
// Exceptions are caught only here; the core returns explicit Result values.

import { parseArgs } from "./core/args.ts";
import { parseConfig, configFromPaths } from "./core/config.ts";
import { parseRef } from "./core/ref.ts";
import { resolveRef, resolveRefs, resolveSourceRef } from "./core/resolve.ts";
import { renderPointer } from "./core/pointer.ts";
import { renderBundle } from "./core/bundle.ts";
import { buildInstallPlan } from "./core/install.ts";
import {
  skillRef,
  skillsToLines,
  skillsToLinesWithFolders,
  renderSourcePreview,
  linesToRefs,
} from "./core/display.ts";
import { historyLine, summariseHistory, renderHistory } from "./core/history.ts";
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
import { loadConfigFile, discoverAll, readSkillFiles, type ConfigFileError } from "./shell/fs.ts";
import { appendHistory, readHistoryFile } from "./shell/history.ts";
import { copyToClipboard, injectPointer, resolveTarget } from "./shell/tmux.ts";
import {
  installGroups,
  resolveProjectRoot,
  type InstallError,
  type ProjectError,
} from "./shell/install.ts";

const HELP = `skl — deliberate agent-skill loader for tmux

The picker is the \`skl-pick\` shell glue (bound to tmux prefix + Alt+s), which
composes this CLI with fzf:

  skl list | fzf --multi --preview 'skl preview {1}' | skl load --stdin --target <pane>

Usage:
  skl <name>                resolve by config precedence, inject pointer
  skl <source>/<name>       inject the exact skill copy
  skl <source>/             inject every skill in a source (a curated group)
  skl --stdin               inject pointers for refs read from stdin
  skl install <ref>         copy skill(s) into the current project (skills add)
  skl install <source>/     copy a whole group into the current project
  skl list                  list discovered skills (fed to fzf)
  skl list --folders        ...with a folder row leading each source block
  skl preview <ref>         render a skill's pointer (the fzf preview)
  skl inline <ref>          print the full content bundle (SKILL.md + retained
                            text files) for pasting where there is no filesystem
  skl history               show usage counts per skill (most-loaded first)
  skl --help                show this help

Options:
  --target <pane>           tmux pane to inject into (default: last-active)
  --path <dir>              override config sources entirely (repeatable)
  --submit                  press Enter after injecting (default: never)
  --copy                    copy pointer(s) to the system clipboard, no injection
  --all                     include files excluded from normal payloads in trees/bundles
  --folders                 list: lead each source block with a "source/  (count)" folder row
  --global                  install: into the global autoload dir, not the project
  --yes                     install: skip the whole-source confirmation prompt
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
    case "exclude-not-array":
      return "config.exclude must be an array";
    case "exclude-not-string":
      return `config.exclude[${e.index}] must be a string`;
    case "path-not-object":
      return `config.paths[${e.index}] is not an object`;
    case "path-missing":
      return `config.paths[${e.index}] is missing a string "path"`;
    case "name-not-string":
      return `config.paths[${e.index}].name must be a string`;
    case "path-exclude-not-array":
      return `config.paths[${e.pathIndex}].exclude must be an array`;
    case "path-exclude-not-string":
      return `config.paths[${e.pathIndex}].exclude[${e.index}] must be a string`;
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
    case "expects-skill":
      return `"${e.source}/" is a whole source — name a skill (e.g. ${e.source}/<name>)`;
  }
};

const fmtProjectError = (e: ProjectError): string => {
  switch (e.kind) {
    case "not-a-work-tree":
      return `not inside a git work-tree (${e.cwd}) — cd into a project first`;
    case "is-home":
      return `refusing to install into your home directory (${e.path})`;
  }
};

const fmtInstallError = (e: InstallError): string =>
  `skills add failed for ${e.sourceRoot}: ${e.stderr || e.command}`;

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

// Best-effort usage logging: warn on stderr but never change the exit code —
// the load itself succeeded, and curation data is not worth failing it for.
const recordLoad = async (
  skill: DiscoveredSkill,
  mode: "inject" | "copy" | "install",
  target: string | null,
  submit: boolean,
): Promise<void> => {
  const appended = await appendHistory(historyLine(skill, mode, target, submit, env.now()));
  if (!appended.ok) env.stderr(`skl: history write failed (${appended.error})\n`);
};

// Inject pointers for one or more refs into a single target pane (or, with
// --copy, write them to the clipboard). The target is resolved once (so stacked
// skills land in the same pane); all refs resolve before any injection, so a
// bad ref fails the batch with no partial injection.
const loadRefs = async (
  refs: readonly string[],
  skills: readonly DiscoveredSkill[],
  options: Options,
): Promise<number> => {
  if (refs.length === 0) return 0; // nothing selected (e.g. fzf cancelled)

  // Resolve the whole batch up front (pure) — bail before injecting anything.
  const resolved = resolveRefs(refs, skills);
  if (!resolved.ok) {
    env.stderr(`skl: ${fmtResolveError(resolved.error)}\n`);
    return 1;
  }

  if (options.copy) {
    // One clipboard write for the whole batch (a second write would clobber the
    // first), same name-then-bulk shape the injection path produces.
    const text = resolved.value
      .map((skill) => renderPointer(skill))
      .map((p) => `${p.skillName} ${p.bulk}`)
      .join("\n\n");
    const copied = await copyToClipboard(text);
    if (!copied.ok) {
      env.stderr(`skl: ${copied.error.stderr || copied.error.command}\n`);
      return 1;
    }
    for (const skill of resolved.value) {
      env.stdout(`skl: copied ${skillRef(skill)} → clipboard\n`);
      await recordLoad(skill, "copy", null, options.submit);
    }
    return 0;
  }

  const target = await resolveTarget(options.target);
  if (!target.ok) {
    env.stderr(`skl: ${target.error.stderr || target.error.command}\n`);
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
    await recordLoad(skill, "inject", target.value, options.submit);
  }
  return 0;
};

// Copy the chosen skills' vetted local bytes into the enclosing project, by
// delegating to `skills add <source-root> --skill <names…>` (one call per source).
// Refs resolve up front (source refs expand) so a bad ref fails before any copy.
const installRefs = async (
  refs: readonly string[],
  skills: readonly DiscoveredSkill[],
  ref: string | null,
  options: Options,
): Promise<number> => {
  if (refs.length === 0) return 0; // nothing selected (e.g. fzf cancelled)

  const resolved = resolveRefs(refs, skills);
  if (!resolved.ok) {
    env.stderr(`skl: ${fmtResolveError(resolved.error)}\n`);
    return 1;
  }

  // Resolve the target project once, before any install (impureim sandwich).
  const projectRoot = await resolveProjectRoot(env.cwd(), env.home());
  if (!projectRoot.ok) {
    env.stderr(`skl: ${fmtProjectError(projectRoot.error)}\n`);
    return 1;
  }

  // A whole-source positional install is a big action — on a TTY, list the
  // members and confirm once. Individual installs and --stdin (the picker,
  // where selection IS the confirmation) never prompt.
  const wholeSource = ref !== null && parseRef(ref).kind === "source";
  if (wholeSource && !options.yes && env.isInteractive()) {
    env.stdout(`skl: install ${resolved.value.length} skills into ${projectRoot.value}:\n`);
    for (const skill of resolved.value) env.stdout(`  ${skillRef(skill)}\n`);
    const answer = env.confirm("proceed? [y/N] ");
    if (answer === null || !/^y(es)?$/i.test(answer.trim())) {
      env.stdout("skl: cancelled\n");
      return 0;
    }
  }

  const plan = buildInstallPlan(resolved.value, { global: options.global });
  const outcomes = await installGroups(plan, projectRoot.value);

  const okRoots = new Set(
    outcomes.filter((o) => o.result.ok).map((o) => o.group.sourceRoot),
  );
  for (const outcome of outcomes) {
    if (!outcome.result.ok) env.stderr(`skl: ${fmtInstallError(outcome.result.error)}\n`);
  }
  for (const skill of resolved.value) {
    if (!okRoots.has(skill.source.path)) continue;
    env.stdout(`skl: installed ${skillRef(skill)} → ${projectRoot.value}\n`);
    await recordLoad(skill, "install", projectRoot.value, options.submit);
  }

  const failed = outcomes.length - okRoots.size;
  if (failed > 0) return 1;
  // Progressive disclosure: the copy is on disk but the running agent hasn't
  // read it — say how to use it now vs on next session.
  env.stdout(
    "skl: restart the agent session to autoload, or `skl load <name>` to use now\n",
  );
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

  // History needs neither config nor discovery — just the machine-local file.
  if (command.kind === "history") {
    const rows = summariseHistory(await readHistoryFile());
    if (rows.length === 0) {
      env.stdout("skl: no usage history yet — load a skill first\n");
      return 0;
    }
    for (const line of renderHistory(rows)) env.stdout(`${line}\n`);
    return 0;
  }

  const config = await buildConfig(command.options);
  if (!config.ok) {
    env.stderr(`skl: ${config.error}\n`);
    return 1;
  }
  const skills = await discoverAll(config.value.sources, { all: command.options.all });

  switch (command.kind) {
    case "list": {
      const lines = command.options.folders
        ? skillsToLinesWithFolders(skills)
        : skillsToLines(skills);
      for (const line of lines) env.stdout(`${line}\n`);
      return 0;
    }
    case "preview": {
      // A folder row (`source/`) previews the whole group's member list; a
      // concrete ref previews that one skill's pointer.
      const ref = parseRef(command.ref);
      if (ref.kind === "source") {
        const members = resolveSourceRef(ref.source, skills);
        if (!members.ok) {
          env.stderr(`skl: ${fmtResolveError(members.error)}\n`);
          return 1;
        }
        env.stdout(`${renderSourcePreview(ref.source, members.value)}\n`);
        return 0;
      }
      const resolved = resolveRef(ref, skills);
      if (!resolved.ok) {
        env.stderr(`skl: ${fmtResolveError(resolved.error)}\n`);
        return 1;
      }
      const pointer = renderPointer(resolved.value);
      env.stdout(`${pointer.skillName}\n\n${pointer.bulk}\n`);
      return 0;
    }
    case "inline": {
      const resolved = resolveRef(parseRef(command.ref), skills);
      if (!resolved.ok) {
        env.stderr(`skl: ${fmtResolveError(resolved.error)}\n`);
        return 1;
      }
      const { files, skipped } = await readSkillFiles(resolved.value);
      env.stdout(`${renderBundle(resolved.value, files)}\n`);
      // Skipped binaries go to stderr so the bundle on stdout stays pasteable.
      for (const rel of skipped) env.stderr(`skl: skipped ${rel} (binary)\n`);
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
    case "install": {
      // Same ref sourcing as load: single positional, or one-per-line from stdin
      // (the picker's ctrl-i). `command.ref` is threaded through for the
      // whole-source confirmation gate.
      const refs = command.ref === null
        ? linesToRefs((await env.stdin()).split("\n"))
        : [command.ref];
      return installRefs(refs, skills, command.ref, command.options);
    }
  }
};

try {
  // Assigning the exit code lets pipe-backed stdout/stderr drain. Calling
  // process.exit() here truncates writes once the pipe buffer reaches 64 KiB.
  process.exitCode = await main(env.argv());
} catch (e) {
  env.stderr(`skl: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
}
