import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandUserPath } from "./seatbelt.js";

export interface BwrapArgsOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  gitWritableRoots?: readonly string[];
  additionalWorkspaceWriteRoots?: readonly string[];
  dialectStateDirs?: readonly string[];
  extraAllowedWritePaths?: readonly string[];
  extraDeniedReadPaths?: readonly string[];
  homeDir?: string;
  tempDir?: string;
}

function resolveExistingPaths(
  rawPaths: readonly string[],
  homeDir: string,
): string[] {
  const seen = new Set<string>();
  for (const rawPath of rawPaths) {
    const trimmed = rawPath.trim();
    if (!trimmed) continue;
    const expanded = path.resolve(expandUserPath(trimmed, homeDir));
    let resolved = expanded;
    try {
      resolved = fs.realpathSync.native(expanded);
    } catch {
      continue;
    }
    seen.add(resolved);
  }
  return [...seen];
}

export function generateBwrapArgs(options: BwrapArgsOptions): string[] {
  const homeDir = options.homeDir ?? os.homedir();
  const tempDir = options.tempDir ?? os.tmpdir();

  const dialectStateDirs = options.dialectStateDirs ?? [
    path.join(homeDir, ".gemini", "antigravity-cli"),
  ];

  const writableDirs = resolveExistingPaths(
    [
      options.cwd,
      ...(options.gitWritableRoots ?? []),
      ...(options.additionalWorkspaceWriteRoots ?? []),
      tempDir,
      "/tmp",
      path.join(homeDir, ".cache"),
      path.join(homeDir, ".npm"),
      path.join(homeDir, ".local", "share", "pnpm"),
      ...dialectStateDirs,
      ...(options.extraAllowedWritePaths ?? []),
    ],
    homeDir,
  );

  const hiddenDirs = resolveExistingPaths(
    [
      path.join(homeDir, ".ssh"),
      path.join(homeDir, ".aws"),
      path.join(homeDir, ".gnupg"),
      path.join(homeDir, ".local", "share", "agy-profiles"),
      ...(options.extraDeniedReadPaths ?? []),
    ],
    homeDir,
  );

  const bwrapArgs: string[] = [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--die-with-parent",
  ];

  for (const dir of writableDirs) {
    bwrapArgs.push("--bind", dir, dir);
  }

  for (const dir of hiddenDirs) {
    bwrapArgs.push("--tmpfs", dir);
  }

  const agySettings = path.join(
    homeDir,
    ".gemini",
    "antigravity-cli",
    "settings.json",
  );
  if (fs.existsSync(agySettings)) {
    bwrapArgs.push("--ro-bind", agySettings, agySettings);
  }

  bwrapArgs.push("--chdir", options.cwd, "--", options.command, ...options.args);
  return bwrapArgs;
}
