#!/usr/bin/env bun
// SHELL: argv → load config/glob/read → core → tmux/fzf → exit code.
// Stub for Phase 1 scaffold verification; real wiring lands in Phase 3.

const HELP = `skl — deliberate agent-skill loader for tmux

Usage:
  skl                       open fzf picker, inject chosen pointer(s)
  skl <name>                resolve by config precedence, inject pointer
  skl <source>/<name>       inject the exact skill copy
  skl list                  list discovered skills as source/name
  skl --help                show this help

Options:
  --target <pane>           tmux pane to inject into (default: last-active)
  --path <dir>              override config sources entirely (repeatable)
  --submit                  press Enter after injecting (default: never)
`;

function main(argv: string[]): number {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  process.stderr.write("skl: not yet implemented\n");
  return 1;
}

process.exit(main(Bun.argv.slice(2)));
