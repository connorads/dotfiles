// The only reader of ambient process state. Everything else takes values.

// A downstream reader closing the pipe early (head, fzf on Esc) is normal for
// a lister, not an error. Bun emits the EPIPE asynchronously as a stream
// 'error' event - no try/catch around the write can see it - so swallow it
// here; subsequent writes no-op the same way and the program completes.
const ignoreEpipe = (e: NodeJS.ErrnoException): void => {
  if (e.code !== "EPIPE") throw e;
};
process.stdout.on("error", ignoreEpipe);
process.stderr.on("error", ignoreEpipe);

export const env = {
  home: (): string => process.env["HOME"] ?? "",
  xdgStateHome: (): string =>
    process.env["XDG_STATE_HOME"] ?? `${process.env["HOME"] ?? ""}/.local/state`,
  /** `SKL_HISTORY_FILE` — usage-history path override (the test seam). */
  historyFileOverride: (): string | null => process.env["SKL_HISTORY_FILE"] ?? null,
  /** ISO-8601 UTC timestamp — the clock stays out of cli.ts and the core. */
  now: (): string => new Date().toISOString(),
  argv: (): string[] => Bun.argv.slice(2),
  stdout: (text: string): void => {
    process.stdout.write(text);
  },
  stderr: (text: string): void => {
    process.stderr.write(text);
  },
  /** Read all of stdin (used by `skl load --stdin`). */
  stdin: (): Promise<string> => Bun.stdin.text(),
};
