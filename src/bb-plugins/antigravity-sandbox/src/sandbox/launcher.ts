import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateBwrapArgs } from "./bwrap.js";
import { gitWritableRootsForWorkspace } from "./git-worktree-roots.js";
import { generateSeatbeltProfile } from "./seatbelt.js";

export interface SandboxLaunchOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  gitWritableRoots?: readonly string[];
  autoDetectGitWorktreeRoots?: boolean;
  additionalWorkspaceWriteRoots?: readonly string[];
  dialectStateDirs?: readonly string[];
  extraAllowedWritePaths?: readonly string[];
  extraDeniedWritePaths?: readonly string[];
  extraDeniedReadPaths?: readonly string[];
  extraSeatbeltRules?: readonly string[];
  homeDir?: string;
  tempDir?: string;
  platform?: NodeJS.Platform;
  sandboxExecPath?: string;
  bwrapPath?: string;
}

export interface WrappedSandboxLaunch {
  backend: "seatbelt" | "bwrap";
  command: string;
  args: string[];
  profilePath?: string;
  gitWritableRoots: string[];
  cleanup: () => void;
}

export function wrapLaunchWithSandbox(
  options: SandboxLaunchOptions,
): WrappedSandboxLaunch {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const tempDir = options.tempDir ?? os.tmpdir();
  const gitWritableRoots =
    options.gitWritableRoots !== undefined
      ? [...options.gitWritableRoots]
      : options.autoDetectGitWorktreeRoots === false
        ? []
        : gitWritableRootsForWorkspace(options.cwd);

  if (platform === "darwin") {
    const profile = generateSeatbeltProfile({
      cwd: options.cwd,
      gitWritableRoots,
      additionalWorkspaceWriteRoots: options.additionalWorkspaceWriteRoots,
      dialectStateDirs: options.dialectStateDirs,
      extraAllowedWritePaths: options.extraAllowedWritePaths,
      extraDeniedWritePaths: options.extraDeniedWritePaths,
      extraDeniedReadPaths: options.extraDeniedReadPaths,
      extraSeatbeltRules: options.extraSeatbeltRules,
      homeDir,
      tempDir,
    });
    fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
    const profilePath = path.join(
      tempDir,
      `bb-antigravity-sandbox-${randomBytes(8).toString("hex")}.sb`,
    );
    fs.writeFileSync(profilePath, profile, { encoding: "utf8", mode: 0o600 });
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        fs.unlinkSync(profilePath);
      } catch {
        // Ignore already-deleted profile file.
      }
    };
    return {
      backend: "seatbelt",
      command: options.sandboxExecPath ?? "/usr/bin/sandbox-exec",
      args: ["-f", profilePath, options.command, ...options.args],
      profilePath,
      gitWritableRoots,
      cleanup,
    };
  }

  if (platform === "linux") {
    const args = generateBwrapArgs({
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      gitWritableRoots,
      additionalWorkspaceWriteRoots: options.additionalWorkspaceWriteRoots,
      dialectStateDirs: options.dialectStateDirs,
      extraAllowedWritePaths: options.extraAllowedWritePaths,
      extraDeniedReadPaths: options.extraDeniedReadPaths,
      homeDir,
      tempDir,
    });
    return {
      backend: "bwrap",
      command: options.bwrapPath ?? "bwrap",
      args,
      gitWritableRoots,
      cleanup: () => {},
    };
  }

  throw new Error(
    `Antigravity workspace sandbox is not supported on platform "${platform}".`,
  );
}

/**
 * Writes a tiny executable POSIX `/bin/sh` wrapper into `tempDir` that
 * conditionally execs `sandbox-exec` (macOS) or `bwrap` (Linux) based on
 * per-turn environment variables (`BB_AGY_SANDBOX_MODE`,
 * `BB_AGY_SANDBOX_PROFILE`). Using `exec` keeps signals transparent and lets
 * BB's ACP bridge automatically restart and `session/load` when toggling
 * between sandboxed (`auto`/`accept-edits`) and unsandboxed (`full`) modes.
 */
export function ensureSandboxExecWrapper(tempDir: string): string {
  fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  const wrapperPath = path.join(tempDir, "bb-agy-sandbox-exec.sh");
  const script = [
    "#!/bin/sh",
    "set -eu",
    'if [ "${BB_AGY_SANDBOX_MODE:-off}" = "seatbelt" ] && [ -n "${BB_AGY_SANDBOX_PROFILE:-}" ]; then',
    '  exec /usr/bin/sandbox-exec -f "$BB_AGY_SANDBOX_PROFILE" "$@"',
    "fi",
    'exec "$@"',
    "",
  ].join("\n");
  fs.writeFileSync(wrapperPath, script, { encoding: "utf8", mode: 0o700 });
  return wrapperPath;
}
