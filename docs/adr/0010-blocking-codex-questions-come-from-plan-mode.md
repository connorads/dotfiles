# Blocking Codex questions come from Plan mode

`features.default_mode_request_user_input` is off in
[`.codex/config.toml`](../../.codex/config.toml). Structured question cards exist
in Plan mode, where they block; Default mode has no question tool and Codex asks
a plain-text question that ends the turn.

## Context

A question card that Codex abandons after two minutes is worse than no card: the
turn continues on an empty answer set, and the answer typed a moment later
arrives at a decision already made.

`is_blocking` looks like the switch for that and is not. It is a client-side
rendering hint. Core awaits the answer on a oneshot with no timeout, always. The
"carries on without me" behaviour belongs entirely to the TUI: 60 seconds of
hidden grace, then a 60-second visible countdown, then `submit_empty_auto_resolution`
posts an empty answer set. Any keypress cancels that timer permanently for that
question.

Core computes the flag in `codex-rs/core/src/tools/handlers/request_user_input.rs`
as one line:

```rust
is_blocking: mode == ModeKind::Plan,
```

No config key reaches it, no env var, no model-facing argument. Only two
collaboration modes exist and custom ones cannot be defined.

So the mode decides, and the config decides the mode a card can appear in.
`default_mode_request_user_input` is what admits cards into Default mode -
the mode where `is_blocking` is false by construction. Upstream's own test
asserts that the flag implies `is_blocking = false`.

The flag was on here to give the vendored `grilling` skill structured
multiple-choice rounds outside Plan mode. It bought the cards and the countdown
together.

## Decision

Turn `default_mode_request_user_input` off, and take blocking from Plan mode
rather than from the flag.

Default mode then exposes no question tool at all, and Codex's bundled prompt
instructs it to "Ask the user directly with one concise plain-text question
instead". That ends the turn, so it blocks by construction rather than by a
setting. Plan mode keeps structured blocking question cards on the supported
path.

The cost is multiple-choice cards outside Plan mode. `grilling`'s own patch
(`grilling-structured-questions`) already names prose numbered lists as the
fallback, so the skill degrades rather than breaks.

The consequence is that the local byte-patch gate over the `codex` binary
retires with the flag, along with its wrapper, manifest store, `up` phase and
mise postinstall.

## Alternatives considered

- **Keep the four-byte binary patch.** It flips the same instruction in the
  shipped binary, which works and stays working until the binary moves. A human
  must re-locate that instruction in a 220MB binary per release, against 24
  releases in two months (`rust-v0.144.0` 2026-07-09 to `rust-v0.153.4`
  2026-09-04). It also flattens what upstream ships as a declared package -
  copying only `bin/codex` out of a layout that also holds
  `codex-package.json`, `bin/codex-code-mode-host`, `codex-path/rg` and
  `codex-resources/zsh/bin/zsh`, then exec'ing from a directory with none of
  them. That is the incident that started this: Codex's shell tool stopped
  launching because `codex-code-mode-host` was missing.

- **Patch the source in a nix `overrideAttrs`.** `pkgs.codex` is a from-source
  build at exactly the installed version, and the change is one
  `substituteInPlace --replace-fail` on a string byte-identical across five
  releases - genuinely better than patching the binary. Rejected on cost, not
  correctness: 10-25GB peak build against 35GB free on `/nix`, and an uncached
  30-60 minute compile per release at one release every 2.5 days. It also drops
  `bundled_zsh_path`, so shell execution falls to `UnifiedExecShellMode::Direct`
  rather than the zsh fork bridge. The config change makes it unnecessary; this
  is the route to reopen if structured rounds outside Plan mode later prove
  load-bearing.

- **A custom app-server client.** Core never times out, so a client that simply
  declines to implement the countdown blocks forever. Structurally the right fix
  and wildly disproportionate to a rendering hint: `codex app-server` is marked
  `[experimental]` in `cli/src/main.rs`, and its 3,058-line protocol README was
  deleted on 2026-09-07 (openai/codex#43421).

- **`developer_instructions` wording, or an `AGENTS.md` rule.** Cannot work.
  `autoResolutionMs` was removed from the model-facing schema by
  openai/codex#36410; the schema is `required: ["questions"]` with
  `additionalProperties: false`, and `is_blocking` is computed in the handler
  after the model's turn. Instructing the model to wait addresses the party that
  does not decide.

- **Use Plan mode alone and leave the flag on.** Plan mode would block, but the
  flag keeps admitting cards into Default mode too, so the non-blocking case
  stays one Shift+Tab away and arrives unannounced. The flag is the mechanism
  that creates the bad state; leaving it on preserves it.

## Known limits

Plan mode's `maybe_prompt_plan_implementation` offers to drop back to Default
the moment a plan lands. Accepting that leaves the session in Default mode, so
questions from that point are plain-text ones again. Blocking follows the mode,
not the conversation.
