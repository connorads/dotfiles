---
name: firecrawl-cli-installation
description: |
  Install the official Firecrawl CLI and handle authentication.
  Package: https://www.npmjs.com/package/firecrawl-cli
  Source: https://github.com/firecrawl/cli
  Docs: https://docs.firecrawl.dev/sdks/cli
---

# Firecrawl CLI Installation

<!-- LOCAL PATCH (connorads dotfiles): upstream instructs `npx`/`npm install -g firecrawl-cli@latest` and `firecrawl setup skills`; firecrawl-cli is owned by mise (`npm:firecrawl-cli`, pinned in mise.lock) and skills are vendored through the review flow, so no task-time install path is wanted. -->

## Setup

`firecrawl-cli` is owned by mise (`npm:firecrawl-cli` in `~/.config/mise/config.toml`, version and checksum pinned in `mise.lock`) and is already on PATH. Do not install, update, or shadow it: no `npx firecrawl-cli`, no `npm install -g`, no `npm update -g`. It moves with the rest of the toolchain via `up`, or `mise upgrade npm:firecrawl-cli` for a one-off.

Do not run `firecrawl setup skills` or `firecrawl setup workflows` either. Those install skills globally into every detected editor, which bypasses the vendored pin-and-review flow. Firecrawl skills are vendored under `~/.config/skills/vendor` and refreshed there.

Authenticate with the binary already on PATH (see Authentication, below).

## Verify

First check status:

```bash
firecrawl --status
```

Then run one small real request to prove install, auth, and output all work:

```bash
mkdir -p .firecrawl
firecrawl scrape "https://firecrawl.dev" -o .firecrawl/install-check.md
```

The install is healthy when both commands succeed.

## Authentication

Authenticate using the built-in login flow:

```bash
firecrawl login --browser
```

This opens the browser for OAuth authentication. Credentials are stored securely by the CLI.

### If authentication fails

Ask the user how they'd like to authenticate:

1. **Login with browser (Recommended)** - Run `firecrawl login --browser`
2. **Enter API key manually** - Run `firecrawl login --api-key "<key>"` with a key from firecrawl.dev

If you cannot obtain a key and the user cannot sign up, search, scrape, and interact still work without an API key on the keyless free tier (rate-limited). Browser login or an API key remains preferred for the best results. See [agent onboarding](https://www.firecrawl.dev/agent-onboarding/SKILL.md) for the full set of onboarding paths.

### Command not found

If `firecrawl` is not found after installation:

1. Confirm mise has it: `mise ls npm:firecrawl-cli` and `mise which firecrawl`
2. If missing, reinstall from the lockfile: `mise install npm:firecrawl-cli`
3. Ensure the mise shims are on PATH (`eval "$(mise activate zsh)"` in the shell profile)
