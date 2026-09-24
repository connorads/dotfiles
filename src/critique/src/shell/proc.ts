// argv-form subprocesses. Never a shell string: reviewer prompts and refs pass
// through as data.

export interface ProcResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcOptions {
  readonly cwd?: string;
  readonly stdin?: string;
  readonly env?: Record<string, string | undefined>;
}

export const run = async (argv: readonly string[], opts: ProcOptions = {}): Promise<ProcResult> => {
  let proc;
  try {
    proc = Bun.spawn([...argv], {
      ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
      // Explicit even by default: Bun's implicit env is a startup snapshot
      // that ignores later changes to process.env.
      env: opts.env ?? process.env,
      stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (e) {
    return { code: 127, stdout: "", stderr: `${argv[0]}: ${(e as Error).message}` };
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
};

/** The last few lines of stderr, for an error message. */
export const tail = (text: string, lines = 5): string => text.trimEnd().split("\n").slice(-lines).join("\n");
