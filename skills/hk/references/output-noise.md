# Keeping hk steps quiet (correctly)

`builtins-by-language.md` and `complete-examples.md` show the step configs. This file is the
cross-cutting *how*: one lever quiets every step on success without losing failure output.

## Principle

**`hk run <hook> -q` is the quiet lever.** On hk ≥ 1.51.0 (PR #1058) `-q` natively quiets
*every* step on success with one flag:

- **Success → 0 bytes.** All step output and hk's progress chrome are dropped.
- **Failure → the failing step's full stdout+stderr survives** (only hk's progress chrome is
  dropped). No diagnostics lost.

So put `-q` on the `.hk-hooks/pre-commit` wrapper (`exec "$HK_BIN" run pre-commit -q "$@"`) and
stop quieting individual commands. No per-step wrapper, no per-tool tiering. This needs
**hk ≥ 1.51.0** — the skill installs `hk = "latest"`, so fresh setups always qualify. On an
older pinned repo the answer is "upgrade hk".

**Never use `--silent`.** It also reaches 0 bytes on success, but on failure it drops the
diagnostics too — you get only `See .../output.log`, useless in an agent context that can't
read that path. Measured on 1.51.0: `--silent` failure → 73 bytes (path only); `-q` failure →
full stdout+stderr.

`-n`/`--no-progress`, `HK_LOG`, `RUST_LOG` remain **no-ops on step success output** — they
touch hk's progress rendering, not the log dump. Don't reach for them to quiet steps.

## Why quieting matters only in the no-TTY agent path

On a real TTY hk writes progress to `/dev/tty`, which bypasses stdout/stderr redirection — so
a human running `git commit` in a terminal sees the same rich output regardless. The bloat
only lands in the **non-TTY agent-capture path** (hk output piped/redirected, e.g. an agent
running the commit), which is exactly where `-q` cleans it up.

### Measured on hk 1.51.0 (non-TTY pipe)

| Config | Plain success | `-q` success |
|--------|---------------|--------------|
| 1 chatty step (5 lines) | 370 B | **0 B** |
| 5 realistic tool steps | 689 B | **0 B** |

Real tools wired as steps (vitest ~257 B, pytest ~370 B) sum to ~1.5 KB of raw success output
→ **0 B under `-q`**. Framed as absolute per-commit cost, `-q` saves roughly tens to ~700
bytes of otherwise-useless success chrome on every commit an agent makes.

## hk's native per-step controls (what they do and don't do)

hk exposes two per-step knobs that trim *its own* chrome. Neither is needed once `-q` is on the
wrapper, but they exist for finer control:

```pkl
["typecheck"] {
    check = "pnpm exec tsc --noEmit"
    output_summary = "stderr"   // "stderr" (default) | "stdout" | "combined" | "hide"
    hide = false                // true removes this step's ✔/✖ status markers
}
```

- `output_summary` controls only the **end-of-run summary block** stream (or hides it).
- `hide = true` removes only the **status markers** for that step.
- Neither touches the **live stream** of the command.

## Failure double-print + the harness-truncation caveat

Without `-q`, on failure hk prints the failing output **twice**: once live as the step runs,
and again in the end-of-run **summary block**. Whether hiding the duplicate is safe depends on
how your agent harness truncates Bash output:

- **Head-keeping truncation** (e.g. Claude Code: keeps the first ~30k chars, drops the tail) →
  the end-anchored summary is dropped first, the head live-stream error survives.
- **Tail-keeping harnesses** → the summary is the only survivor → hiding it loses the error.

`-q` sidesteps this entirely: on failure it yields a **single small failure copy** (the failing
step's stdout+stderr, progress chrome stripped), which is safe under both head- and tail-keeping
truncation. This is another reason to prefer wrapper-level `-q` over `output_summary = "hide"`.

## What `terminal_progress` actually is

`terminal_progress = false` disables the **OSC terminal-progress escape sequences** hk emits to
the terminal — it does **not** reduce stdout noise. Set it to keep escape codes out of captured
logs, but don't reach for it expecting quieter step output.
