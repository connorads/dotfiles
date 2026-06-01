# Compose fzf in the shell pipeline, don't spawn it from Bun

The picker is a shell script (`bin/pick`, symlinked as `~/.local/bin/skl-pick`)
that pipes the (TTY-free) `skl` CLI through fzf:

```
skl list | fzf --multi --preview 'skl preview {1}' | skl load --stdin --target <pane>
```

The tmux keybind (`prefix + A`) runs `skl-pick #{pane_id}` in a `display-popup`.
fzf runs in the popup's **real terminal**; the `skl` binary never spawns fzf.

## The dead-end this supersedes

The original design had the Bun CLI spawn fzf itself (`Bun.spawn(["fzf", …])`)
and drive a `pick` command. That dragged in a chain of accidental complexity:

- fzf spawned with Bun pipes on both fd0 and fd1 gets no usable controlling
  terminal — it enters the alt-screen, accepts itself, and exits `0` before
  rendering, which collapsed the `display-popup` instantly.
- The first fix fed fzf its candidate list via a `$TMPDIR/skl-pick-<pid>.list`
  temp file (`stdin: Bun.file`) with a `finally` cleanup.
- Guarding that regression then needed a ~120-line integration test that ran the
  spawn inside a real tmux pane, drove it with `send-keys`, and read the chosen
  refs back from a result file — a pseudo-terminal harness for what is two pipes.
- `cli.ts` grew `shQuote`, a preview-command builder, `--path` re-quoting, and a
  `SKL_POPUP` env flag to pass `--reverse` through the layers.

All of that existed **only because Bun was spawning fzf**. The repo's own session
and window pickers (`tmux.conf` `S`/`W`) never had the problem: they pipe
`tmux … | fzf | xargs tmux …`, with fzf in the popup's TTY.

## Decision

Match that idiom. `skl` is a plain CLI with no interactive concerns:

- `skl list` → `ref  description` lines (ref = first whitespace token, so fzf's
  default `{1}` is the ref — no `--delimiter`/`--with-nth` needed).
- `skl preview <ref>` → the fzf preview.
- `skl load --stdin` → reads selected lines, parses the ref out of each, injects.

fzf, `--reverse`, multi-select binds, and the preview window all live in the
shell script where they belong.

## Consequences

- Deleted: `src/shell/fzf.ts`, `tests/fzf.integration.test.ts`, the `pick`
  command, `shQuote`/preview plumbing, and `env.popup()`/`SKL_POPUP`.
- The list⇄load contract is now testable as plain process spawns with no TTY
  (`tests/pipeline.integration.test.ts`): `skl list | skl load --stdin` injects
  into a real pane and asserts the pointers land verbatim.
- One extra entrypoint (`bin/pick`) and a `~/.local/bin/skl-pick` symlink; the
  Bun launcher shim stays the only Bun-facing thing in `bin`.
- fzf must be on the tmux server's PATH (it already is — the `S`/`W` pickers rely
  on the same), and `skl` on `~/.local/bin`, which `bin/pick` prepends to `PATH`.

## Note on ADR-0003

ADR-0003 (tmux injection via `load-buffer`/`paste-buffer -p`) is unchanged —
`skl load` still delivers pointers exactly that way. Only the picker mechanism
changed. The earlier "tension with ADR-0003" framing is moot: there is no longer
a Bun-spawned fzf to feed, so no competing stdin strategy to reconcile.
