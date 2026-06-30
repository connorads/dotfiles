# Keeping hk steps quiet (correctly)

`builtins-by-language.md` and `complete-examples.md` say *which* steps to wrap. This file is
the cross-cutting *how*: how to decide, per tool, whether a step needs quieting at all — and
how to do it without breaking failure output.

## Principle

**Suppress noise at the source, not in hk.** hk has **no native quiet-on-success** in a
non-TTY / agentic context: `-q`, `--silent`, `-n`, `HK_LOG`, `RUST_LOG` are all no-ops on the
log dump (measured, hk 1.48.0). So the only lever is the *command a step runs*. Quiet only the
steps that print *on success*; failures must always survive.

## The 3-tier decision (decide by checking, not from a hardcoded list)

Run the tool on clean input and look at what it prints on success. That places it in one tier:

| Tier | Success output | What to do | Examples |
|------|----------------|------------|----------|
| **1** | Truly silent (0 bytes) | **Nothing** — wrapping buys nothing | eslint, `tsc --noEmit`, `tsgo --noEmit`, shellcheck, gitleaks `--log-level=error`, `ruff format --quiet` |
| **2** | Prints a summary, but has a *true* silence flag | **Use the flag** — more direct than the wrapper, keeps colour/streaming | `ruff check` → `ruff check -q` (→ 0 bytes ✓) |
| **3** | Prints, no true silence flag | **Wrap** with `scripts/quiet-on-success.sh` — the universal fallback | pytest, vitest, jest, `go test`, `cargo test`, biome/ultracite, prettier `--check`, astro check, svelte-check |

Only **tier 1** makes wrapping pure waste. For tiers 2-3 the wrapper (or the flag) removes
real lines that would otherwise dump on every successful commit.

### Verifying a tool's tier

```bash
<tool> ...           # run it on clean input — does it print anything on success?
<tool> --help | grep -iE 'quiet|silent|log-level'
```

`-q` is **not** universally "silent" — confirm it actually reaches 0 bytes before trusting it:

- `ruff check -q` → **0 bytes** ✓ (true silence flag → tier 2)
- `pytest -q` → still prints `...` + a summary line (~97 bytes) → **tier 3**, wrap it
- `vitest --silent` / `jest --silent` → only silence test `console.log`, not the reporter → **tier 3**
- `ruff check` (no flag) → prints `All checks passed!` (18 bytes) → **not** silent on its own

Tier-2 candidates worth checking at setup (success summary + a documented flag, verify before use):
`prettier --check` (`All matched files use Prettier code style!`) with `--log-level warn`;
otherwise treat as tier 3. biome/ultracite, astro check, svelte-check, `ruff format --check`
have no verified 0-byte flag → tier 3.

### Worked numbers

`scripts/quiet-on-success.sh pnpm exec vitest run` on a passing suite: **734 → 233 bytes
(−68%)**, and failure output is **unchanged** (the wrapper reprints everything on non-zero exit).

## hk's native per-step controls (what they do and don't do)

hk exposes two knobs that trim *its own* chrome. **Neither suppresses a command's own
output** — only a silent command (tier 1/2) or the wrapper (tier 3) does that.

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

On failure hk prints the failing output **twice**: once live as the step runs, and again in the
end-of-run **summary block**. `output_summary = "hide"` drops the duplicate summary — but
whether that's safe depends on **how your agent harness truncates Bash output**, which is not
knowable upfront:

- **Head-keeping truncation** (e.g. Claude Code v2.1.195: keeps the first ~30k chars, drops the
  tail with `... [N lines truncated] ...`; stdout+stderr merged, stderr last) → the end-anchored
  summary is dropped *first*, the head live-stream error survives → `output_summary = "hide"`
  is **safe** (removes a duplicate you'd lose anyway).
- **Tail-keeping harnesses** → the summary is the *only* survivor → hiding it **loses the
  error**. Unsafe.

**Default: leave hk's default** (keep both copies). Only set `output_summary = "hide"` when you
know the harness keeps the head.

## What `terminal_progress` actually is

`terminal_progress = false` disables the **OSC terminal-progress escape sequences** hk emits to
the terminal — it does **not** reduce stdout noise. Set it to keep escape codes out of captured
logs, but don't reach for it expecting quieter step output.

## The wrapper's tradeoffs (pick it knowingly)

`assets/quiet-on-success.sh` is `output=$("$@" 2>&1); code=$?; [ $code -ne 0 ] && printf '%s\n'
"$output"; exit $code`. Consequences, intentional for its job:

- **Merges stderr into stdout** (`2>&1`) — on failure everything prints to stdout, ordering by
  stream is lost.
- **Buffers** the whole run — nothing appears until the command exits, so a slow tier-3 step
  shows no live progress.
- **Drops colour / TTY** — the wrapped command sees a pipe, not a terminal.

These are fine for a fast, chatty-on-success test runner whose only job is "say nothing unless I
broke something". They're exactly why you **don't** wrap tier-1 tools: you'd pay the buffering
and colour loss for zero noise removed.
