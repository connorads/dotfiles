## CLI (Recommended)

{{marker}}

`elevenlabs` is already on PATH: the CLI is owned by mise (`npm:@elevenlabs/cli` in
`~/.config/mise/config.toml`, version and checksum pinned in `mise.lock`). Do not install,
update, or shadow it - no `npm install -g`, no Homebrew tap, no Scoop bucket, and above all
no `curl ... | sh` installer, which bypasses every release-age and checksum control in this
toolchain. It moves with the rest of the toolchain via `up`, or
`mise upgrade npm:@elevenlabs/cli` for a one-off.
