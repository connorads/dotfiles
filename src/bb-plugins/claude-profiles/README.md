# Claude Profiles for BB

Choose an existing Claude Code login from the composer, beside the model picker.
Keep the native conversation when switching. Read each account's quota through
the native Claude CLI.

## Use

The account status shows in the composer while Claude Code is the selected
provider. It shows the current account. Clicking it opens the Alt+F picker with
the **Claude account** select focused. The picker is the only place to change
the account.

New thread:

1. Click the account status, or run **Agent Switcher: switch account** with the caret in the composer.
2. Choose an account in the **Claude account** select.
3. Send the first message. The thread starts on that account.

The new-thread choice is remembered, like the model picker. A new Claude
thread starts on it until you choose another.

A thread that another thread starts takes that thread's named account instead:

- A child created with `--parent-self`, `--parent-thread` or an SDK
  `parentThreadId` takes its parent's account.
- A fork takes its source thread's account.
- A parent on Default, a non-Claude parent and a `bb thread spawn` without a
  parent use the remembered choice.

If the inherited account does not exist on the new thread's machine, the first
send is refused. The plugin never falls back to another account.

Existing thread:

1. Finish or stop the turn. Clear queued messages. The account select is disabled during a turn.
2. Click the account status and choose an account.
3. Send the next message. Claude resumes the same native conversation.

In the picker, keys 1-9 select favourites, not accounts. Press `Esc` to close.
**Agent Switcher: switch account** has no default shortcut. Assign one in
BB's keyboard settings if needed.

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
    User->>Plugin: Select profile in an idle thread's composer
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
and clears API-key and alternate-provider overrides for threads on a named
profile. Default and unselected threads receive no environment contribution:
Claude resolves an empty `CLAUDE_CONFIG_DIR` against the working directory.
`HOME` stays unchanged.

BB starts Claude anyway when an env contributor throws, times out or is not
loaded, so a thread on a named profile could run on the native login. Each
launch records a `provider.env-resolved` event. The plugin reviews it on thread
activity and before every send. A launch without the selected profile's
directory is stopped, and the next send is refused once with an explanation.
Sending again relaunches with fresh env. Event activity is debounced to once a
second, so the first request of a bad launch can still reach the native login.

A send from a machine other than the account's own is refused before Claude
starts. Choose the thread's account again on that machine.

A new thread has no session to copy. Its first send passes BB's
`message.dispatch` hook before the provider environment resolves. The hook
copies the remembered choice to the thread, resolving the profile on the
thread's host. A missing profile on that host rejects the send.

A switch starts a new prompt cache on the target account, so the next request
re-sends the whole conversation uncached. When [Cache Hits](../cache-hits/README.md)
is enabled, the switch marks its chip cold.

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

The new-thread picker lists profiles from the first connected host. The first
send resolves the choice on the thread's own host. Sessions with subagent
sidecars cannot switch profiles in this version. BB's Claude bridge copies a
fork's session in its own config directory, not in the thread's account. A
Claude fork therefore works only when the source and the fork both run on
Default.
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
