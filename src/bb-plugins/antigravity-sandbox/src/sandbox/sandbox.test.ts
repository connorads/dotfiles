import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  escapeSeatbeltString,
  generateBwrapArgs,
  generateSeatbeltProfile,
  gitWritableRootsForWorkspace,
  wrapLaunchWithSandbox,
} from "./index.js";

const tempDirs: string[] = [];

function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("gitWritableRootsForWorkspace", () => {
  it("returns empty array for a non-git folder or normal git checkout", () => {
    const dir = mkTempDir("agy-sb-normal-");
    expect(gitWritableRootsForWorkspace(dir)).toEqual([]);

    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    expect(gitWritableRootsForWorkspace(dir)).toEqual([]);
  });

  it("returns minimal linked-worktree git metadata roots without granting parent checkout", () => {
    const base = mkTempDir("agy-sb-wt-");
    const mainRepo = path.join(base, "main");
    const wtDir = path.join(base, "wt-1");
    fs.mkdirSync(mainRepo);

    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: mainRepo });
    fs.writeFileSync(path.join(mainRepo, "a.txt"), "hi\n");
    execFileSync("git", ["add", "a.txt"], { cwd: mainRepo });
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@users.noreply.github.com", "commit", "-q", "-m", "init"],
      { cwd: mainRepo },
    );
    execFileSync("git", ["worktree", "add", "-q", "-b", "feat", wtDir], {
      cwd: mainRepo,
    });

    const roots = gitWritableRootsForWorkspace(wtDir);
    const realMainGit = fs.realpathSync.native(path.join(mainRepo, ".git"));
    const realMainRepo = fs.realpathSync.native(mainRepo);

    expect(roots.length).toBeGreaterThanOrEqual(2);
    expect(roots).not.toContain(realMainRepo);
    expect(roots).toContain(path.join(realMainGit, "worktrees", "wt-1"));
    expect(roots).toContain(path.join(realMainGit, "objects"));
  });

  it("rejects forged .git file pointing to an unrelated directory", () => {
    const base = mkTempDir("agy-sb-forged-");
    const ws = path.join(base, "ws");
    const victim = path.join(base, "victim");
    fs.mkdirSync(ws);
    fs.mkdirSync(victim);
    fs.writeFileSync(path.join(ws, ".git"), `gitdir: ${victim}\n`);

    expect(gitWritableRootsForWorkspace(ws)).toEqual([]);
  });
});

describe("generateSeatbeltProfile", () => {
  it("escapes quotes and backslashes cleanly", () => {
    expect(escapeSeatbeltString('/tmp/a"b\\c')).toBe('/tmp/a\\"b\\\\c');
  });

  it("generates required PTY, network, workspace write, and secret read-deny rules", () => {
    const home = "/Users/tester";
    const profile = generateSeatbeltProfile({
      cwd: "/Users/tester/git/demo",
      gitWritableRoots: ["/Users/tester/git/main/.git/worktrees/demo"],
      additionalWorkspaceWriteRoots: ["/Users/tester/.bb/thread-storage/thr_1"],
      extraDeniedReadPaths: ["~/Secrets"],
      extraSeatbeltRules: ['(deny mach-lookup (global-name "com.apple.securityd"))'],
      homeDir: home,
      tempDir: "/tmp/test-tmp",
    });

    expect(profile).toContain("(version 1)");
    expect(profile).toContain("(deny default)");
    expect(profile).toContain('(allow file-ioctl (literal "/dev/ptmx")');
    expect(profile).toContain("(allow signal (target same-sandbox))");
    expect(profile).toContain("(allow network-outbound)");
    expect(profile).toContain('(subpath "/Users/tester/git/demo")');
    expect(profile).toContain(
      '(subpath "/Users/tester/git/main/.git/worktrees/demo")',
    );
    expect(profile).toContain(
      '(subpath "/Users/tester/.bb/thread-storage/thr_1")',
    );
    expect(profile).toContain('(subpath "/Users/tester/.ssh")');
    expect(profile).toContain('(subpath "/Users/tester/Secrets")');
    expect(profile).toContain(
      '(literal "/Users/tester/.gemini/antigravity-cli/settings.json")',
    );
    expect(profile).toContain(
      '(deny mach-lookup (global-name "com.apple.securityd"))',
    );
  });
});

describe("wrapLaunchWithSandbox & generateBwrapArgs", () => {
  it("writes a 0600 Seatbelt file on darwin and cleans it up", () => {
    const tmp = mkTempDir("agy-sb-wrap-");
    const wrapped = wrapLaunchWithSandbox({
      command: "agy",
      args: ["acp", "--process-per-session", "--dangerously-skip-permissions"],
      cwd: tmp,
      tempDir: tmp,
      platform: "darwin",
      autoDetectGitWorktreeRoots: false,
    });

    expect(wrapped.backend).toBe("seatbelt");
    expect(wrapped.command).toBe("/usr/bin/sandbox-exec");
    expect(wrapped.profilePath).toBeTruthy();
    expect(fs.existsSync(wrapped.profilePath!)).toBe(true);
    const mode = fs.statSync(wrapped.profilePath!).mode & 0o777;
    expect(mode).toBe(0o600);

    wrapped.cleanup();
    expect(fs.existsSync(wrapped.profilePath!)).toBe(false);
  });

  it("builds linux bwrap args with read-only root and writable workspace", () => {
    const tmp = mkTempDir("agy-sb-bwrap-");
    const args = generateBwrapArgs({
      command: "agy",
      args: ["acp"],
      cwd: tmp,
      homeDir: tmp,
      tempDir: tmp,
    });
    expect(args).toContain("--ro-bind");
    expect(args).toContain("--bind");
    expect(args).toContain("--chdir");
    expect(args.slice(-3)).toEqual(["--", "agy", "acp"]);
  });

  it.skipIf(process.platform !== "darwin")(
    "enforces linked-worktree commit allowance and blocks parent checkout writes under real macOS sandbox-exec",
    () => {
      const base = mkTempDir("agy-sb-live-wt-");
      const mainRepo = path.join(base, "main");
      const wtDir = path.join(base, "wt-live");
      const sbDir = mkTempDir("agy-sb-profile-");
      fs.mkdirSync(mainRepo);

      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: mainRepo });
      fs.writeFileSync(path.join(mainRepo, "a.txt"), "hi\n");
      execFileSync("git", ["add", "a.txt"], { cwd: mainRepo });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@users.noreply.github.com",
          "commit",
          "-q",
          "-m",
          "init",
        ],
        { cwd: mainRepo },
      );
      execFileSync("git", ["worktree", "add", "-q", "-b", "feat", wtDir], {
        cwd: mainRepo,
      });

      const realWt = fs.realpathSync.native(wtDir);
      const realMain = fs.realpathSync.native(mainRepo);
      const gitRoots = gitWritableRootsForWorkspace(realWt);
      const profile = generateSeatbeltProfile({
        cwd: realWt,
        gitWritableRoots: gitRoots,
        homeDir: os.homedir(),
        tempDir: sbDir,
      });
      const sbPath = path.join(sbDir, "test.sb");
      fs.writeFileSync(sbPath, profile, { mode: 0o600 });

      // 1. Inside linked worktree: write + git add + git commit succeeds.
      execFileSync(
        "/usr/bin/sandbox-exec",
        [
          "-f",
          sbPath,
          "/bin/zsh",
          "-lc",
          'echo ok > inside.txt && git add inside.txt && git -c user.name=Test -c user.email=test@users.noreply.github.com commit -q -m "sandbox worktree commit"',
        ],
        { cwd: realWt, stdio: "pipe" },
      );
      const logLine = execFileSync("git", ["log", "-1", "--pretty=%s"], {
        cwd: realWt,
        encoding: "utf8",
      }).trim();
      expect(logLine).toBe("sandbox worktree commit");

      // 2. Writing to parent checkout MUST be blocked.
      expect(() =>
        execFileSync(
          "/usr/bin/sandbox-exec",
          [
            "-f",
            sbPath,
            "/bin/zsh",
            "-lc",
            `touch "${path.join(realMain, "escape.txt")}"`,
          ],
          { cwd: realWt, stdio: "pipe" },
        ),
      ).toThrow();
      expect(fs.existsSync(path.join(realMain, "escape.txt"))).toBe(false);
    },
  );
});
