# Installation

The Dubbing Projects API is available via the `elevenlabs` CLI under `elevenlabs dubbing project`, in the official SDKs under `dubbing.project.*`, and via REST at `/v1/dubbing/project`. The older `client.dubbing.*` methods (`create`, `get`, `audio.get`) are the **legacy v1 dubbing API** — do not use them for new work.

## CLI (Recommended)

<!-- LOCAL PATCH (connorads dotfiles): the `elevenlabs` CLI is owned by mise (`npm:@elevenlabs/cli`, pinned in mise.lock); upstream's global npm/brew/scoop installs and its `curl | sh` bootstrap all bypass the release-age and checksum controls, so no task-time install path is wanted. -->

`elevenlabs` is already on PATH: the CLI is owned by mise (`npm:@elevenlabs/cli` in
`~/.config/mise/config.toml`, version and checksum pinned in `mise.lock`). Do not install,
update, or shadow it - no `pnpm add -g`, no Homebrew tap, no Scoop bucket, and above all
no `curl ... | sh` installer, which bypasses every release-age and checksum control in this
toolchain. It moves with the rest of the toolchain via `up`, or
`mise upgrade npm:@elevenlabs/cli` for a one-off.

Authenticate with an API key (picked up automatically from the environment):

```bash
export ELEVENLABS_API_KEY="your-api-key"
```

Or log in via OAuth, which stores credentials in the OS keyring:

```bash
elevenlabs auth login
```

Verify it works:

```bash
elevenlabs dubbing project list
```

## Python

```bash
uv add elevenlabs requests
```

(`requests` is used to download the dubbed audio from the signed output URL.)

```python
import os
from elevenlabs.client import ElevenLabs

# Reads ELEVENLABS_API_KEY from the environment
elevenlabs = ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))

page = elevenlabs.dubbing.project.list(page_size=20)
```

## JavaScript / TypeScript

```bash
pnpm add @elevenlabs/elevenlabs-js
```

> **Important:** Always use `@elevenlabs/elevenlabs-js`. The old `elevenlabs` npm package (v1.x) is deprecated and should not be used.

```javascript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Reads ELEVENLABS_API_KEY from the environment
const elevenlabs = new ElevenLabsClient();

const page = await elevenlabs.dubbing.project.list({ pageSize: 20 });
```

## CLI Usage

The REST base URL is `https://api.elevenlabs.io`, with your API key in the `xi-api-key` header on every request. For command-line use, prefer the CLI — it wraps the same endpoints and reads `ELEVENLABS_API_KEY` automatically:

```bash
elevenlabs dubbing project create --file promo.mp4 --source-language en
```

## Getting an API Key

Use the existing credential workflow. Use `fnox exec -- <command>` for command credentials. Report missing credentials and stop that path. Do not download a CLI, run onboarding, or write project credentials during this workflow. Any separately requested credential change follows the local credential-storage instructions.

For an explicitly requested manual API-key setup:

1. Sign up at [elevenlabs.io](https://elevenlabs.io)
2. Go to [API Keys](https://elevenlabs.io/app/settings/api-keys)
3. Click **Create API Key**
4. Copy and store securely

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ELEVENLABS_API_KEY` | Your ElevenLabs API key (required) |
