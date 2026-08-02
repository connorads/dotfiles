// install adapter: copy vetted local skill bytes into a project by delegating to
// `skills add <sourceRoot> --skill <names…>`. Every call is argv-form Bun.spawn
// (no shell strings), mirroring shell/tmux.ts. `skills add` treats the source
// root as a `sourceType: "local"` source and copies it in place — no fetch.

import { realpathSync } from "node:fs";
import { ok, err, type Result } from "../core/result.ts";
import type { InstallGroup } from "../core/install.ts";

/** Resolving the target project failed before any install ran. */
export type ProjectError =
  // cwd is not inside a git work-tree (`git rev-parse --show-toplevel` failed).
  | { readonly kind: "not-a-work-tree"; readonly cwd: string }
  // The work-tree root is $HOME — refuse (defence in depth; dotfiles' detached
  // git-dir already makes rev-parse fail in ~, but never install into home).
  | { readonly kind: "is-home"; readonly path: string };

/** One `skills add` invocation failed. */
export interface InstallError {
  readonly kind: "install-failed";
  readonly sourceRoot: string;
  readonly command: string;
  readonly stderr: string;
}

/** Per-group result, so a failed group is reported without stopping the rest. */
export interface InstallOutcome {
  readonly group: InstallGroup;
  readonly result: Result<void, InstallError>;
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

// Spawn a command in `cwd`. A missing binary (ENOENT throws synchronously in Bun)
// becomes a code-127 result with a clear message rather than an uncaught throw.
const run = async (argv: readonly string[], cwd: string): Promise<RunResult> => {
  try {
    const proc = Bun.spawn([...argv], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { code, stdout, stderr };
  } catch {
    return { code: 127, stdout: "", stderr: `could not run \`${argv[0]}\` (not on PATH?)` };
  }
};

const sameDir = (a: string, b: string): boolean => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};

/**
 * Resolve the enclosing git work-tree root from `cwd`, refusing $HOME. `home` is
 * passed in (the shell's only ambient read stays in env.ts).
 */
export const resolveProjectRoot = async (
  cwd: string,
  home: string,
): Promise<Result<string, ProjectError>> => {
  const r = await run(["git", "-C", cwd, "rev-parse", "--show-toplevel"], cwd);
  const root = r.stdout.trim();
  if (r.code !== 0 || root.length === 0) return err({ kind: "not-a-work-tree", cwd });
  if (sameDir(root, home)) return err({ kind: "is-home", path: root });
  return ok(root);
};

/**
 * Install each group into `projectRoot` via `skills add`. A group's failure is
 * collected and does not stop later groups; the caller decides the exit code.
 */
export const installGroups = async (
  groups: readonly InstallGroup[],
  projectRoot: string,
): Promise<InstallOutcome[]> => {
  const outcomes: InstallOutcome[] = [];
  for (const group of groups) {
    const argv = [
      "skills",
      "add",
      group.sourceRoot,
      "--skill",
      ...group.names,
      "-y",
      ...(group.global ? ["-g"] : []),
    ];
    const r = await run(argv, projectRoot);
    if (r.code !== 0) {
      outcomes.push({
        group,
        result: err({
          kind: "install-failed",
          sourceRoot: group.sourceRoot,
          command: argv.join(" "),
          stderr: (r.stderr || r.stdout).trim(),
        }),
      });
      continue;
    }
    outcomes.push({ group, result: ok(undefined) });
  }
  return outcomes;
};
