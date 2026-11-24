import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SeatbeltProfileOptions {
  cwd: string;
  gitWritableRoots?: readonly string[];
  additionalWorkspaceWriteRoots?: readonly string[];
  dialectStateDirs?: readonly string[];
  extraAllowedWritePaths?: readonly string[];
  extraDeniedWritePaths?: readonly string[];
  extraDeniedReadPaths?: readonly string[];
  extraSeatbeltRules?: readonly string[];
  homeDir?: string;
  tempDir?: string;
}

export function escapeSeatbeltString(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

export function expandUserPath(rawPath: string, homeDir: string): string {
  if (rawPath === "~") {
    return homeDir;
  }
  if (rawPath.startsWith("~/")) {
    return path.join(homeDir, rawPath.slice(2));
  }
  return rawPath;
}

function resolvePathVariants(rawPath: string, homeDir: string): string[] {
  const expanded = path.resolve(expandUserPath(rawPath, homeDir));
  const variants = new Set<string>([expanded]);
  try {
    variants.add(fs.realpathSync.native(expanded));
  } catch {
    // Path may not exist yet; keep the expanded normalized path.
  }
  return [...variants];
}

function uniquePathVariants(
  rawPaths: readonly string[],
  homeDir: string,
): string[] {
  const seen = new Set<string>();
  for (const rawPath of rawPaths) {
    const trimmed = rawPath.trim();
    if (!trimmed) {
      continue;
    }
    for (const variant of resolvePathVariants(trimmed, homeDir)) {
      seen.add(variant);
    }
  }
  return [...seen];
}

function formatSubpathRules(paths: readonly string[]): string {
  return paths
    .map((p) => `  (subpath "${escapeSeatbeltString(p)}")`)
    .join("\n");
}

function formatLiteralRules(paths: readonly string[]): string {
  return paths
    .map((p) => `  (literal "${escapeSeatbeltString(p)}")`)
    .join("\n");
}

export function defaultDeniedReadSubpaths(homeDir: string): string[] {
  return [
    path.join(homeDir, ".ssh"),
    path.join(homeDir, ".aws"),
    path.join(homeDir, ".gnupg"),
    path.join(homeDir, ".local", "share", "agy-profiles"),
    path.join(homeDir, ".docker", "run"),
    path.join(homeDir, ".docker", "desktop"),
    path.join(homeDir, ".colima"),
    path.join(homeDir, ".orbstack", "run"),
    path.join(homeDir, ".rd"),
    "/var/run/docker",
    "/private/var/run/docker",
    "/Users/Shared/.docker",
  ];
}

export function defaultDeniedReadLiterals(homeDir: string): string[] {
  return [
    path.join(homeDir, ".bb", "auth.json"),
    path.join(homeDir, ".bb", "auth-secret"),
    path.join(homeDir, ".netrc"),
    path.join(homeDir, "_netrc"),
    path.join(homeDir, ".git-credentials"),
    path.join(homeDir, ".gitcookies"),
    "/var/run/docker.sock",
    "/var/run/docker.sock.raw",
    "/private/var/run/docker.sock",
    "/private/var/run/docker.sock.raw",
  ];
}

export function defaultDeniedWriteLiterals(homeDir: string): string[] {
  return [
    path.join(homeDir, ".gemini", "antigravity-cli", "settings.json"),
    path.join(homeDir, ".bb", "auth.json"),
    path.join(homeDir, ".bb", "auth-secret"),
    path.join(homeDir, ".netrc"),
    path.join(homeDir, "_netrc"),
    path.join(homeDir, ".git-credentials"),
    path.join(homeDir, ".gitcookies"),
  ];
}

export function generateSeatbeltProfile(
  options: SeatbeltProfileOptions,
): string {
  const homeDir = options.homeDir ?? os.homedir();
  const tempDir = options.tempDir ?? os.tmpdir();

  const defaultCaches = [
    path.join(homeDir, ".cache"),
    path.join(homeDir, ".npm"),
    path.join(homeDir, "Library", "Caches"),
    path.join(homeDir, "Library", "pnpm"),
    path.join(homeDir, ".local", "share", "pnpm"),
  ];

  const dialectStateDirs = options.dialectStateDirs ?? [
    path.join(homeDir, ".gemini", "antigravity-cli"),
  ];

  const writableSubpaths = uniquePathVariants(
    [
      options.cwd,
      ...(options.gitWritableRoots ?? []),
      ...(options.additionalWorkspaceWriteRoots ?? []),
      tempDir,
      "/private/tmp",
      "/tmp",
      ...defaultCaches,
      ...dialectStateDirs,
      ...(options.extraAllowedWritePaths ?? []),
    ],
    homeDir,
  );

  const deniedWriteSubpaths = uniquePathVariants(
    [
      path.join(homeDir, ".ssh"),
      path.join(homeDir, ".aws"),
      path.join(homeDir, ".gnupg"),
      path.join(homeDir, ".local", "share", "agy-profiles"),
      ...(options.extraDeniedWritePaths ?? []),
    ],
    homeDir,
  );
  const deniedWriteLiterals = uniquePathVariants(
    defaultDeniedWriteLiterals(homeDir),
    homeDir,
  );

  const deniedReadSubpaths = uniquePathVariants(
    [
      ...defaultDeniedReadSubpaths(homeDir),
      ...(options.extraDeniedReadPaths ?? []),
    ],
    homeDir,
  );
  const deniedReadLiterals = uniquePathVariants(
    defaultDeniedReadLiterals(homeDir),
    homeDir,
  );

  const lines: string[] = [
    "(version 1)",
    "(deny default)",
    "",
    ";; Allow reading host files (toolchains, nix, mise, git hooks) and executing processes",
    "(allow file-read*)",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal (target same-sandbox))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow system-socket)",
    "(allow ipc-posix-shm*)",
    "(allow ipc-posix-sem)",
    "(allow pseudo-tty)",
    '(allow file-ioctl (literal "/dev/ptmx") (regex #"^/dev/tty.*"))',
    "",
    ";; Allow loopback (BB CLI, bb-bridge MCP) and outbound network",
    "(allow network-bind)",
    "(allow network-inbound)",
    "(allow network-outbound)",
    "",
    ";; Allow writes strictly inside workspace, linked git worktree roots, caches, temp, and agent state",
    "(allow file-write*",
    formatSubpathRules(writableSubpaths),
    '  (literal "/dev/stdout")',
    '  (literal "/dev/stderr")',
    '  (literal "/dev/null")',
    '  (literal "/dev/ptmx")',
    '  (literal "/dev/tty")',
    '  (regex #"^/dev/ttys[0-9]*$")',
    ")",
    "",
    ";; Protect sensitive config, credentials, and isolated profile directories from writes",
    "(deny file-write*",
    formatSubpathRules(deniedWriteSubpaths),
    formatLiteralRules(deniedWriteLiterals),
    ")",
    "",
    ";; Protect sensitive credentials and container daemon sockets from reads",
    "(deny file-read*",
    formatSubpathRules(deniedReadSubpaths),
    formatLiteralRules(deniedReadLiterals),
    ")",
  ];

  const extraRules = (options.extraSeatbeltRules ?? [])
    .map((rule) => rule.trim())
    .filter((rule) => rule.length > 0);
  if (extraRules.length > 0) {
    lines.push("", ";; Composed extra Seatbelt rules", ...extraRules);
  }

  return `${lines.join("\n")}\n`;
}
