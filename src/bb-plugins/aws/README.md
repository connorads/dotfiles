# AWS

Choose the AWS profile a BB thread may use. BB mints short-lived credentials
with [Granted](https://granted.dev) and serves them to that thread's agent.
Agents never sign in to AWS and never read `~/.aws`.

## Use

1. In a thread, press `⌥W` or run **Choose AWS profile** from the palette.
2. Type to filter the profiles in `~/.aws/config`. Press Enter or click to choose.
   **Off** removes AWS access for the thread.
3. Optionally type a region. It overrides the profile's region for this thread.
4. If a profile needs a sign-in, press **Sign in with Granted**. Granted opens
   your browser. Agents get a 503 asking them to have you sign in.

A choice applies to the thread's next AWS call. A mid-thread switch needs no restart.

## Model

```mermaid
flowchart LR
  Person[Person: ⌥W picker] -->|choice per thread| Plugin[aws plugin server]
  Agent[Agent: aws / SDK] -->|container credentials URL + thread token| Route[/creds?thread=id]
  Route --> Plugin
  Plugin -->|granted credential-process --profile X| Granted[Granted cache / SSO]
```

- Every Claude Code, Codex and Pi process gets these variables at launch:
  `AWS_CONTAINER_CREDENTIALS_FULL_URI`, `AWS_CONTAINER_AUTHORIZATION_TOKEN`,
  `AWS_CONFIG_FILE` (a per-thread file holding only `region`),
  `AWS_SHARED_CREDENTIALS_FILE=/dev/null` and `AWS_EC2_METADATA_DISABLED=true`.
  AWS SDKs and the CLI read the container credentials URL natively.
- The route accepts only the thread's own random token. It is registered with
  `auth: "none"` because an SDK cannot send BB's plugin token or Origin.
- A mint never passes `--auto-login`. Only the person's **Sign in** does.
- Only STS session credentials are served. A profile that returns long-lived
  IAM user keys (no session token) is refused, because an agent could keep them.
- An AWS SDK waits about 2 seconds for container credentials, and Granted takes
  5-13 seconds. The plugin mints when a profile is chosen and re-mints profiles
  used in the last two hours before their cache margin, so requests hit the cache.
  A failure is repeated for 30 seconds without running Granted again.
- Credentials are reported with at most 30 minutes' lifetime, so a long-running
  SDK process picks up a switch within that time. CLI calls pick it up at once.
- The choice is a routing preference, not a security boundary. An agent with BB
  CLI or RPC access can change it.

## Limits

- Local host only: agents reach the route through BB's loopback server.
- Existing agent processes keep their launch environment. Restart a thread once
  after installing.
- Granted has no machine-readable errors, so sign-in detection matches phrases
  in its output ([broker.ts](src/broker.ts)).

## Settings

- **Granted executable**: default `granted`. Set a full path if BB's `PATH` lacks it.
- **AWS config file**: default `~/.aws/config`.

## Checks

```zsh
pnpm test        # core: fake Granted + real AWS CLI against the route; ui: picker
pnpm typecheck
pnpm build
```
