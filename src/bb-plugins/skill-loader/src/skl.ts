// Adapter over the `skl` CLI. skl stays the single source of truth for
// sources, payload filters and install rules; this only shapes argv and
// output. The process runner is a port so tests drive it with a fake.

import { parseListLines, type Row } from './rows.ts';

export type RunResult = { readonly code: number; readonly stdout: string; readonly stderr: string };
export type Run = (argv: readonly string[], options?: { cwd?: string; stdin?: string }) => Promise<RunResult>;

export type InstallOutcome = { readonly ok: boolean; readonly output: string };

export type Skl = {
  list(): Promise<Row[]>;
  preview(ref: string): Promise<string>;
  /**
   * Pointer text for refs (folders expand to their members) from one
   * `skl load --stdin --print`, which records each skill in skl's usage history.
   */
  pointers(refs: readonly string[]): Promise<string>;
  /** `skl install --stdin` from `cwd`; skl resolves the project and refuses $HOME or non-repos. */
  install(refs: readonly string[], cwd: string): Promise<InstallOutcome>;
};

export function createSkl(run: Run): Skl {
  const checked = async (argv: readonly string[], stdin?: string): Promise<string> => {
    const result = await run(argv, { stdin });
    if (result.code !== 0) throw new Error(result.stderr.trim() || `skl ${argv.join(' ')} exited ${result.code}`);
    return result.stdout;
  };
  const list = async () => parseListLines((await checked(['list', '--folders'])).split('\n'));
  const preview = (ref: string) => checked(['preview', ref]);
  return {
    list,
    preview,
    async pointers(refs) {
      // skl resolves the whole batch before printing, so one unknown ref fails it.
      return (await checked(['load', '--stdin', '--print'], `${refs.join('\n')}\n`)).replace(/\s+$/, '');
    },
    async install(refs, cwd) {
      const result = await run(['install', '--stdin'], { cwd, stdin: `${refs.join('\n')}\n` });
      const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
      return { ok: result.code === 0, output: output || `skl install exited ${result.code}` };
    },
  };
}
