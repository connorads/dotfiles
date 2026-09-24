// The --settings document that confines the Claude reviewer. Two layers,
// because the allowlist alone leaks in both directions:
// - Bash runs in Claude's native sandbox (sandbox-runtime, the engine srt
//   wraps) with the reviewed repo write-denied: `Bash(git diff:*)` also
//   matches `git diff --output=<file>`, and `git diff --no-index` reads any
//   file. Network is off; read-only git needs none.
// - Read/Grep/Glob run outside that sandbox, and `--setting-sources ""` drops
//   the user's own Read() denies, so the secret paths are denied here again.
// Both deny lists come from ~/.config/srt/base.json's denyRead, the one list
// every other agent surface mirrors. See ADR 0001.

export interface SandboxPaths {
  readonly home: string;
  /** denyRead entries as base.json spells them: `~/x` or absolute. */
  readonly denyRead: readonly string[];
  /** Absolute paths the reviewer must not write: the repo, and a PR's worktree. */
  readonly denyWrite: readonly string[];
}

const expand = (home: string, p: string): string => (p === "~" ? home : p.startsWith("~/") ? `${home}${p.slice(1)}` : p);

/** Claude permission-rule paths: `~/x` stays home-relative, `/abs` becomes `//abs`. */
const rulePath = (p: string): string => (p.startsWith("~/") ? p : p.startsWith("/") ? `/${p}` : p);

export const claudeSettings = (paths: SandboxPaths) => ({
  permissions: {
    deny: paths.denyRead.flatMap((p) => {
      const r = rulePath(p);
      return [`Read(${r})`, `Read(${r}/**)`];
    }),
  },
  sandbox: {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: false,
    filesystem: {
      denyRead: paths.denyRead.map((p) => expand(paths.home, p)),
      denyWrite: [...paths.denyWrite],
    },
    network: { allowedDomains: [] },
  },
});
