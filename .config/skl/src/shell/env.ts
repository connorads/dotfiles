// The only reader of ambient process state. Everything else takes values.

export const env = {
  home: (): string => process.env["HOME"] ?? "",
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

