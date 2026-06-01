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
  /** Set by the tmux popup keybind so the picker renders top-down. */
  popup: (): boolean => process.env["SKL_POPUP"] === "1",
};

