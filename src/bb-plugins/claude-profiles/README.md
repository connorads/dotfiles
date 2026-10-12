# Agent Switcher for BB

Choose the model, its effort and the Claude Code account for a thread from one
picker. Keep the native conversation when switching accounts. Show each
account's quota in the thread header and in an all-account overlay.

The plugin ID is `claude-profiles`, so its CLI is `bb claude-profiles`. BB
shows it as **Agent Switcher**. [ADR 0001](../docs/adr/0001-consolidate-agent-switcher.md)
records why it absorbs Model Favourites and Agent Usage.

## Use

### Picker

Press **Alt+F**, click the star beside the prompt, or choose **Switch model** in
the composer's plus menu. The picker opens on the focused composer, in a thread
or a new-thread composer. It changes the next turn and keeps the draft. It never
sends a prompt.

1. Search by model or provider. Favourites appear first.
2. Click a model to select it, or click its star to save it as a favourite.
3. Set the effort and tier for this turn in the footer.
4. Choose the Claude account in the **Claude account** select. It shows while
   Claude Code is the selected provider.

### Favourites and effort

Up to nine favourites fit in numbered slots. Removing one leaves the other slot
numbers unchanged. Each favourite has a **Saved effort** select.

| Case | Behaviour |
| --- | --- |
| Saved effort that the model supports | Selecting the favourite sets that effort. |
| Saved effort that the model no longer supports | The row is disabled with the reason. Its effort select stays editable. |
| No saved effort (**Default**) | Selecting the favourite uses the model's default effort, not the composer's current one. |
| Footer effort changed | Only this composer changes. Saved efforts stay. |

Cycling skips disabled favourites. A favourite whose provider is unavailable on
this machine stays visible with a reason. Favourites persist in plugin storage
and update across open views.

### Accounts

The account status shows in the composer while Claude Code is the selected
provider. It shows the current account. Clicking it opens the picker with the
**Claude account** select focused. The picker is the only place to change the
account.

New thread:

1. Click the account status, or run **Agent Switcher: switch account** with the caret in the composer.
2. Choose an account in the **Claude account** select.
3. Send the first message. The thread starts on that account.

The new-thread choice is remembered, like the model picker. A new Claude thread
starts on it until you choose another, unless another thread starts it. See the
[new-thread rule](#new-thread-rule).

Existing thread:

1. Finish or stop the turn. Clear queued messages. The account select is disabled during a turn.
2. Click the account status and choose an account.
3. Send the next message. Claude resumes the same native conversation.

**Default** means the thread has no named account. It uses the native default
configuration.

Profiles come from `~/.claude-profiles/code/` on the thread's host. Plugin
settings accept another profile root and Claude executable. The plugin does not
create accounts or sign you in.

### Usage

The thread header shows the limit most likely to stop the thread. A ring shows
its use. The text adds the run-out or reset time when the window needs
attention. Hover over it for every window. A Claude thread shows its bound
account's quota.

Click the badge or press `⌘⇧A` to open the usage overlay. It groups every
account by provider, and by machine when more than one reports. It opens with
one sentence on the worst window. When an account needs attention, it names the
same provider's account with the most room. **Refresh** requests fresh
readings. Codex reset credits show beneath the Codex accounts.

Each timed window compares use with even spending across the window.

| Status | Meaning |
| --- | --- |
| Under pace / On pace | Use is more than 5 points below, or within 5 points of, even spending |
| Ahead of pace | Use is more than 5 points above even spending, under 1.2× |
| At this pace, out HH:MM | At 1.2× even spending or faster |
| Limit reached | The window is full until its reset |
| Reset since last check | The reading predates its reset, so no percentage is shown |

Amber marks 1.2× pace or 70% used. Red marks 1.4× pace, 90% used or a full
window. A reading becomes stale after 4% of its shortest window, with a
15-minute minimum. Stale bars use stripes and omit projections.

The overlay reads BB's built-in **Provider usage** plugin. Enable it for
providers other than Claude.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Open picker (**Agent Switcher: open picker**) | Alt+F |
| Next favourite | Alt+Shift+F |
| Previous favourite | Assign in BB keyboard settings |
| Select favourite 1-9 | Assign in BB keyboard settings |
| Switch account (opens the picker on the account select) | Assign in BB keyboard settings |
| Show usage | ⌘⇧A |

Inside the picker:

| Action | Key |
| --- | --- |
| Move between models | Up / Down |
| Select the focused model or first search result | Enter |
| Select a favourite slot | 1-9 when search is empty, or outside the search field |
| Close and return to the composer | Escape, or Q outside text fields |

## New-thread rule

A thread that another thread starts takes that thread's account, Default
included:

- A child created with `--parent-self`, `--parent-thread` or an SDK
  `parentThreadId` takes its parent's account.
- A fork takes its source thread's account.
- A parent that never had an account chosen, a non-Claude parent and a
  `bb thread spawn` without a parent use the remembered composer choice.

If the inherited account does not exist on the new thread's machine, the first
send is refused. The plugin never falls back to another account.

On stock BB a native send carries no plugin data, so the plugin cannot read an
account chosen for one draft. It reads the remembered choice when the first
message dispatches.

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

The plugin has two modules. `src/accounts/` owns bindings, routing, the guard,
transcript handover, quota and usage. `src/models/` owns favourites and their
saved effort. The picker and the usage overlay in `ui/` own no data. They call
the modules through the plugin's typed RPC.

The server owns thread selection and checks BB state. The host worker owns local
directory discovery, transcript copying, native CLI calls and Codex reset
credits.

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
binds the thread by the new-thread rule, resolving the profile on the thread's
host. A missing profile on that host rejects the send.

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
caches successful measurements for one minute. The header badge and the RPC
handlers share that cache. Refresh requests bypass it. Paid extra usage is
outside the subscription quota display.

The plugin also implements BB's discoverable `provider-usage.v1` source contract.
An enabled Provider Usage panel can list these profiles and request individual
measurements. Each resource belongs to its BB host. Listing reads directory
metadata and never requests quota. The plugin does not enable that panel or change
its other sources.

Codex reset credits come from the tmux collector's `~/.cache/codex-usage.json`.
A refresh runs `~/.config/zsh/functions/codex-usage` with its cache, lock and
backoff rules. The plugin does not read credentials or redeem credits.

## CLI

```sh
bb claude-profiles list THREAD_ID
bb claude-profiles switch THREAD_ID work
bb claude-profiles usage THREAD_ID work
bb claude-profiles overview [--refresh]
bb claude-profiles header THREAD_ID
bb claude-profiles migrate-favourites
```

`overview` and `header` print the usage overlay and header data as JSON.
`migrate-favourites` copies Model Favourites' list into this plugin's storage.
It needs Model Favourites enabled, prints `{ imported, skipped }` and changes
nothing on a second run.

## Scope

The new-thread picker lists profiles from the first connected host. The first
send resolves the choice on the thread's own host. Sessions with subagent
sidecars cannot switch profiles in this version. BB's Claude bridge copies a
fork's session in its own config directory, not in the thread's account. A
Claude fork therefore works only when the source and the fork both run on
Default.
Switching a thread to another host requires selecting a profile on that host.

A migrated favourite keeps its service tier, but selection does not apply it.

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
bb plugin reload claude-profiles
```

`pnpm test` runs node:test over `src/` and vitest over `app.test.tsx` and `ui/`.
Package install scripts stay disabled. BB provides React at runtime. The test
dependencies provide React and the official SDK app harness locally.

`dist/` is what live BB loads. Build only when you mean to reload it. To check a
build first, copy the plugin to a new `$TMPDIR` directory and build there.

Tests cover transcript copying, return switching, conflicts, symlinks, subagent
refusal, quota parsing, control requests, cancellation, the new-thread rule,
favourites with saved effort, migration, the picker and the usage views.
The disposable live proof is documented in [SPIKE.md](./SPIKE.md).
