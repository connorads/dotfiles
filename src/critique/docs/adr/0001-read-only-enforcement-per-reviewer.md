# Read-only enforcement per reviewer

A reviewer must be unable to change the repository it reviews, whatever the
diff, the repo's own config or the model's judgement says. Each reviewer gets
its own enforcement, because the two CLIs expose different mechanisms, and
neither relies on the prompt asking the model not to write.

## Context

The change under review is untrusted input. A PR can carry comments written to
steer the reviewer, and its own `.claude/settings.json` or `AGENTS.md`. An
instruction in the prompt is not enforcement.

The predecessor skill, `cross-review`, ran Claude with `--permission-mode plan`.
Tested headless, plan mode leaked. The user allowlist (`Bash(echo:*)`) still
applied inside it, and `echo y >> a.txt` wrote to the repo. A reviewed repo's
own `.claude/settings.json` applies too. Plan mode also writes to
`~/.claude/plans`. `pejmanjohn/cc-plugin-codex` has the same hole: it passes no
permission mode at all.

## Decision

**Codex** runs `codex exec -s read-only`, its OS sandbox, which fails every
write whatever the model tries. `-c project_doc_max_bytes=0` stops it
auto-loading the reviewed repo's `AGENTS.md`. Guidance reaches the reviewer only
through critique's prompt, which for a PR reads it from the base ref.

**Claude** runs with:

- `--setting-sources ""`, so neither the user's settings nor the reviewed
  repo's `.claude/settings.json` can widen permissions. This also stops
  `CLAUDE.md` auto-loading (checked: a planted `CLAUDE.md` instruction was
  followed with default sources and ignored with none).
- `--permission-mode dontAsk` plus `--tools Read Grep Glob Bash` and an
  allowlist of `Read`, `Grep`, `Glob` and `Bash(git diff|log|show|status:*)`.
  There is no Write or Edit tool.
- `--settings` from `core/sandbox.ts`, for the two things the allowlist cannot
  express:
  - Bash runs in Claude's native sandbox with the repo write-denied and the
    network off. `Bash(git diff:*)` also matches `git diff --output=<file>`.
    Checked with the allowlisted command: it wrote `pwn.txt` without the
    sandbox and failed with `Operation not permitted` with it.
  - `Read()` denies for every path in `~/.config/srt/base.json`'s `denyRead`,
    also passed to the sandbox's `denyRead` for Bash. `--setting-sources ""`
    drops the user's own `Read()` denies along with everything else. Checked:
    Glob listed `~/.ssh` without the rule and was denied with it.

## Alternatives considered

- **Wrap `claude -p` in `srt`**, as `asb` wraps other agents. This was the
  plan. It blocked writes, but Claude then reported `Not logged in`: the OAuth
  token is in the login keychain, and `base.json` denies `~/Library/Keychains`.
  Allowing keychain reads to the whole reviewer process would give it every
  secret in the keychain. `asb`'s own notes also say not to wrap tools that have
  a native sandbox, because nested Seatbelt profiles break. The native sandbox
  runs the same sandbox-runtime engine, scoped to Bash, where the gap is.
- **`--permission-mode plan`.** Leaks, as above.
- **Claude `--bare`.** It skips `CLAUDE.md` and hooks, but it only accepts
  API-key auth, not the OAuth login.

## Consequences

- The Claude reviewer depends on `~/.config/srt/base.json`. Without it the
  reviewer fails rather than running with no secret-path denies.
- Codex's read-only sandbox allows reading anywhere, secrets included. In the
  probe, the model read `~/.ssh/known_hosts` by using the `SECRETS_OK` override
  that the user's global instructions document. A hostile diff could therefore
  steer Codex into quoting a secret in a finding. `--post` only ever creates a
  pending review, so a human sees the text before it is published.
- Claude's permission layer denied `git diff --output` and
  `git diff --no-index` outright in some runs, before the sandbox saw them.
  Treat that as a bonus, not the control. The sandbox is the control.
