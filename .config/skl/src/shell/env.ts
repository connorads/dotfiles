// The only reader of ambient process state. Everything else takes values.

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
