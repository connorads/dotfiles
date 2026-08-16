{{marker}}

## Setup

`firecrawl-cli` is owned by mise (`npm:firecrawl-cli` in `~/.config/mise/config.toml`, version and checksum pinned in `mise.lock`) and is already on PATH. Do not install, update, or shadow it: no `npx firecrawl-cli`, no `npm install -g`, no `npm update -g`. It moves with the rest of the toolchain via `up`, or `mise upgrade npm:firecrawl-cli` for a one-off.

Do not run `firecrawl setup skills` or `firecrawl setup workflows` either. Those install skills globally into every detected editor, which bypasses the vendored pin-and-review flow. Firecrawl skills are vendored under `~/.config/skills/vendor` and refreshed there.

Authenticate with the binary already on PATH (see Authentication, below).