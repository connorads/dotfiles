# Keeping hk steps quiet

Use `hk run <hook> -q` in tracked wrappers. On hk 1.51.0 and hk 2.0.1,
non-TTY checks confirm quiet success and useful failure diagnostics, provided
the step does not set `output_summary = "hide"`.

```sh
exec "$HK_BIN" run pre-commit -q "$@"
```

Keep each tool's normal command. Per-step shell wrappers that capture output
are unnecessary. Preserve existing tool-native quiet flags when useful.

## Output controls

| Setting | Success | Failure |
|---|---|---|
| `-q` | No step output or progress chrome | Both failing-command streams in the summary |
| `--silent` | No step output or progress chrome | Diagnostics suppressed; only the output-log pointer remains |
| `-q` with `output_summary = "hide"` | No step output or progress chrome | Diagnostics suppressed; only the output-log pointer remains |

Do not use `--silent` or `output_summary = "hide"` for wrappers whose failure
output an agent or CI must read. Quiet mode does not override a hidden summary.

`-n`/`--no-progress` controls progress rendering, not successful command output.
`terminal_progress = false` disables OSC terminal-progress escape sequences,
not stdout. Neither replaces `-q`.

## Per-step settings

```pkl
["typecheck"] {
    check = "pnpm exec tsc --noEmit"
    output_summary = "stderr"
    hide = false
}
```

`output_summary` selects the success-summary stream (`stderr`, `stdout`,
`combined`) or suppresses the summary (`hide`). In v2.0.1 a failure summary
uses both streams regardless of the selected stream, unless it is hidden.
`hide = true` controls the step's status markers, not its command output.

Without `-q`, failed output can appear both during execution and in the final
summary. Keep the summary: progress messages can truncate long lines, and
agent output capture can discard the beginning of a long run. Use `-q` to
suppress success noise while retaining the failure summary.

## Verify wrapper behaviour

Use an isolated repo with a chatty check that writes distinct markers to
stdout and stderr. Capture both streams without a TTY:

1. Run a successful check with `-q`; expect no output.
2. Make it fail with `-q`; expect non-zero status and both markers.
3. Set `output_summary = "hide"`; confirm both markers disappear, then remove
   that setting from the wrapper's steps.

These cases are verified on 2026-09-20 against hk 2.0.1. Treat non-TTY measurements
as capture behaviour; verify terminal rendering separately when changing it.

## Sources

- [Quiet and silent tests](https://github.com/jdx/hk/blob/v2.0.1/test/quiet_silent.bats)
- [Failure output capture](https://github.com/jdx/hk/blob/v2.0.1/src/step/output.rs)
- [Summary rendering](https://github.com/jdx/hk/blob/v2.0.1/src/hook.rs)
