# Installation

## Server Environment

Set credentials on the server. Do not expose the ElevenLabs API key in browser code.

```bash
export ELEVENLABS_API_KEY="your-elevenlabs-api-key"
export ELEVENLABS_SPEECH_ENGINE_ID="seng_..."
```

For local development, expose the server publicly before creating the Speech Engine resource:

```bash
ngrok http 3001
export PUBLIC_WS_URL="wss://your-ngrok-domain.ngrok.app/ws"
```

The browser token endpoint uses the same `ELEVENLABS_SPEECH_ENGINE_ID`.

## JavaScript / TypeScript

Server dependencies:

```bash
pnpm add @elevenlabs/elevenlabs-js dotenv
```

If the server uses Express for the token endpoint:

```bash
pnpm add express
pnpm add -D tsx @types/express
```

Browser clients:

```bash
pnpm add @elevenlabs/react
# or, for vanilla browser JavaScript:
pnpm add @elevenlabs/client
```

Always use `@elevenlabs/elevenlabs-js`, `@elevenlabs/react`, or `@elevenlabs/client`. Do not use the deprecated `elevenlabs` npm package.

## Python

Server dependencies:

```bash
uv add elevenlabs python-dotenv
```

If building the token endpoint in Flask:

```bash
uv add flask
```

Use the async SDK for Speech Engine servers:

```python
from elevenlabs import AsyncElevenLabs

client = AsyncElevenLabs()
```

## Local Development Checklist

- `ngrok http 3001` is running and points to the Speech Engine server port.
- The Speech Engine resource was created with a `wss://.../ws` `ws_url` / `wsUrl`.
- The server is listening on the same path, usually `/ws`.
- The token endpoint runs server-side and returns a short-lived conversation token.
- The browser asks for microphone permission before `startSession(...)`.
- First-message client overrides are enabled on the Speech Engine resource before passing `overrides.agent.firstMessage`.
- Server callbacks include `on_disconnect` / `onDisconnect` if unexpected WebSocket drops need handling.
- `debug: true` is enabled while developing so transcript and lifecycle issues are visible.

## Production Notes

- Replace ngrok with your public HTTPS host and use its `wss://` WebSocket URL.
- Keep the WebSocket path stable; updating the host requires updating or recreating the Speech Engine resource.
- Store API keys in managed secrets.
- Add shutdown handling so `SpeechEngineAttachment.close()` or the Python server process stops cleanly.
- Pass TypeScript `AbortSignal` values to downstream async work to cancel interrupted responses.

## Getting an API Key

Use the existing credential workflow. Use `fnox exec -- <command>` for command credentials. Report missing credentials and stop that path. Do not download a CLI, run onboarding, or write project credentials during this workflow. Any separately requested credential change follows the local credential-storage instructions.

For an explicitly requested manual API-key setup:

1. Sign up at [elevenlabs.io](https://elevenlabs.io)
2. Go to [API Keys](https://elevenlabs.io/app/settings/api-keys)
3. Click **Create API Key**
4. Copy and store securely
