# Claude Profiles for BB

Choose an existing Claude Code login per thread. Keep its native conversation
when switching profiles. Read each account's quota through the native Claude CLI.

## Use

1. Open a Claude Code thread and send its first message.
2. Finish or stop its turn. Clear queued messages.
3. Click the account button, or run **Claude: switch account** from the command palette.
4. Click an account, or press its number. Arrow keys and `Enter` also work.
5. Send the next message. Claude resumes the same native conversation.

The header button shows the selected account. The menu lists accounts with a
selection tick and number shortcuts. Press `Q` or `Esc` to close. **Claude: switch account**
has no default shortcut. Assign one in BB's keyboard settings if needed.

[Agent usage](../agent-usage/README.md) shows quota in a separate header badge and
all-account overlay. Its shortcut is `⌘⇧A`. Claude Profiles supplies quota through
its native CLI backend. Quota reads send no model prompt.

Profiles come from `~/.claude-profiles/code/` on the thread's host. **Default** uses
the native default configuration. Plugin settings accept another profile root
and Claude executable. The plugin does not create accounts or sign you in.

```sh
bb claude-profiles list THREAD_ID
bb claude-profiles switch THREAD_ID work
bb claude-profiles usage THREAD_ID work
```

## Design

```mermaid
sequenceDiagram
    participant User
    participant Plugin as BB plugin server
    participant Host as Plugin host worker
    participant Claude as Native Claude Code
    User->>Plugin: Select profile on idle thread
    Plugin->>Host: Check target native login
    Host->>Claude: auth status --json
    Plugin->>Plugin: Stop and release thread runtime
    Plugin->>Host: Transfer this session transcript
    Host->>Host: Reject conflicting history; copy atomically
    Plugin->>Plugin: Persist thread profile selection
    User->>Claude: Next message through BB
    Claude->>Claude: Resume session under selected config directory
```

The server owns thread selection and checks BB state. The host worker owns local
directory discovery, transcript copying and native CLI calls. The app uses typed
RPC and displays account selection.

The plugin reuses BB's Claude Code provider. It contributes `CLAUDE_CONFIG_DIR`
and clears API-key and alternate-provider overrides for selected threads.
Unselected threads receive no environment contribution. `HOME` stays unchanged.

Switching copies only the native session transcript. It leaves credentials,
settings and unrelated sessions separate. Returning to a profile advances its
older transcript only when its contents are an exact prefix of the current one.
Conflicting history, symlink paths and transcripts above 64 MiB cause refusal.
Source transcripts remain intact. Transcript files can contain conversation
content and tool results, so the target profile receives that content.

Quota requests use Claude's stream-JSON control protocol: `initialize`, then
`get_usage` with `skip_behaviors: true`. The plugin sends no user message. It bounds
the request time and output size, terminates the process on cancellation, and
caches successful measurements for one minute. Refresh requests bypass that
cache. Paid extra usage is outside the subscription quota display.

The plugin also implements BB's discoverable `provider-usage.v1` source contract.
An enabled Provider Usage panel can list these profiles and request individual
measurements. Each resource belongs to its BB host. Listing reads directory
metadata and never requests quota. The plugin does not enable that panel or change
its other sources.

## Scope

The account selector appears after BB provisions a Claude thread's environment.
Choose the account after the first turn. Sessions with subagent sidecars cannot
switch profiles in this version. BB forks do not inherit plugin selections.
Switching a thread to another host requires selecting a profile on that host.

The plugin supports manual Claude switching and quota collection. It does not
rotate accounts automatically, track historical token costs, or switch Codex
accounts. Disabling it removes account selection from future provider launches.

Anthropic's [Claude Code authentication policy](https://code.claude.com/docs/en/legal-and-compliance)
distinguishes native Claude login from collecting or intermediating subscription
tokens. This plugin delegates authentication to the unmodified CLI and does not
read tokens, proxy OAuth or call authenticated usage endpoints directly. This
design is not a guarantee against account suspension.

## Development

Requirements: BB 0.45+, Plugin SDK 0.6.15, Node 24+, pnpm, native Claude Code.
Native continuation and quota collection are verified with Claude Code 2.1.293.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
bb plugin install "$PWD"
pnpm dev
```

Package install scripts stay disabled. BB provides React at runtime. The test
dependencies provide React and the official SDK app harness locally.

Tests cover transcript copying, return switching, conflicts, symlinks, subagent
refusal, quota parsing, control requests, cancellation and account controls.
The disposable live proof is documented in [SPIKE.md](./SPIKE.md).
