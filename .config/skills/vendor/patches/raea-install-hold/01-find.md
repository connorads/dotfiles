## 1. Install (once) — HEADLESS
<!-- sources: tools/release.sh apps/site/public/install engine/cli/src/skill.rs -->

- macOS (Apple Silicon) or Linux (x86_64): `curl -fsSL https://raea.io/install | sh`. Windows 10 or 11, in
  PowerShell: `irm https://raea.io/install.ps1 | iex`. Either puts `raea` under `~/.raea`, puts it on your PATH, and
  adds this skill to `~/.claude/skills`. Run it again to update. `raea help` lists every verb.
- Another agent: `raea skills install --agent claude|codex|kimi|gemini` puts this skill where that agent reads skills.
  `--pin quieter` (any move) adds a `/quieter` that loads one move. For Claude it also adds a hook that runs
  `raea check --quick` after a composition is saved and hands you what it finds.
- This file's front matter names the raea it shipped with (`version:`). If `raea --version` prints another, read
  `raea skill` instead: it is this skill as your raea ships it.
- From a checkout of the repository: `cargo build --release -p raea-cli`; the binary is `target/release/raea`.
- Optional settings live in `~/.raea/env` (`docs/settings.md`). Rendering needs none of them.
