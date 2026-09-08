# Installation

## CLI (Recommended)

<!-- LOCAL PATCH (connorads dotfiles): the `elevenlabs` CLI is owned by mise (`npm:@elevenlabs/cli`, pinned in mise.lock); upstream's global npm/brew/scoop installs and its `curl | sh` bootstrap all bypass the release-age and checksum controls, so no task-time install path is wanted. -->

`elevenlabs` is already on PATH: the CLI is owned by mise (`npm:@elevenlabs/cli` in
`~/.config/mise/config.toml`, version and checksum pinned in `mise.lock`). Do not install,
update, or shadow it - no `npm install -g`, no Homebrew tap, no Scoop bucket, and above all
no `curl ... | sh` installer, which bypasses every release-age and checksum control in this
toolchain. It moves with the rest of the toolchain via `up`, or
`mise upgrade npm:@elevenlabs/cli` for a one-off.

Authenticate with either:

```bash
# Option 1: Environment variable (picked up automatically)
export ELEVENLABS_API_KEY="your-api-key"

# Option 2: OAuth login (stores credentials in the OS keyring)
elevenlabs auth login
```

## JavaScript / TypeScript

```bash
npm install @elevenlabs/elevenlabs-js
```

> **Important:** Always use `@elevenlabs/elevenlabs-js`. The old `elevenlabs` npm package (v1.x) is deprecated and should not be used.

```javascript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Option 1: Environment variable (recommended)
// Set ELEVENLABS_API_KEY in your environment
const client = new ElevenLabsClient();

// Option 2: Pass directly
const client = new ElevenLabsClient({ apiKey: "your-api-key" });
```

### Migrating from deprecated packages

If you have old packages installed, remove them:

```bash
# Remove deprecated packages
npm uninstall elevenlabs

# Install the current packages
npm install @elevenlabs/elevenlabs-js
```

**Import changes:**
```javascript
// OLD (deprecated)
import { ElevenLabsClient } from "elevenlabs";

// NEW (current)
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
```

## Python

```bash
pip install elevenlabs
```

```python
from elevenlabs import ElevenLabs

# Option 1: Environment variable (recommended)
# Set ELEVENLABS_API_KEY in your environment
client = ElevenLabs()

# Option 2: Pass directly
client = ElevenLabs(api_key="your-api-key")
```

## CLI Usage

Once installed and authenticated, no headers or keys are needed on the command line:

```bash
elevenlabs text-to-speech convert --voice-id JBFqnCBsd6RMkjVDRZzb \
  --text "Hello world" --model-id eleven_multilingual_v2 --output output.mp3
```

## Getting an API Key

1. Sign up at [elevenlabs.io](https://elevenlabs.io)
2. Go to [API Keys](https://elevenlabs.io/app/settings/api-keys)
3. Click **Create API Key**
4. Copy and store securely

Or use the `setup-api-key` skill for guided setup.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ELEVENLABS_API_KEY` | Your ElevenLabs API key (required) |
