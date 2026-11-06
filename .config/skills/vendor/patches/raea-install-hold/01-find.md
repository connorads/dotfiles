## Set up (once)

1. macOS on Apple Silicon. Install (or update) raea: `curl -fsSL https://raea.io/install | sh`. It puts `raea`
   in `~/.raea/bin`, links it from `~/.local/bin` (make sure that's on `PATH`, ahead of any older `raea`), and adds this
   skill and raea-bevy to `~/.claude/skills`. Check it with `raea help` (it prints its usage).
2. From a checkout of the repository instead: `cargo build --release -p raea-cli` at its root (Rust stable); the
   binary is `target/release/raea`.
3. Optional settings live in `~/.raea/env` (see `docs/settings.md`). Rendering needs none of them.
