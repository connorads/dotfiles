# Agent Switcher for BB

Choose the model, its effort and the Claude Code account for a thread from one
picker. Keep the native conversation when switching accounts. Show each
account's quota in the thread header and in an all-account overlay.

The plugin ID is `claude-profiles`, so its CLI is `bb claude-profiles`. BB
shows it as **Agent Switcher**. [ADR 0001](../docs/adr/0001-consolidate-agent-switcher.md)
records why it absorbs Model Favourites and Agent Usage.

## Model selection

BB owns the model picker and favourites. Alt+F opens its single model control.
Favourites appear first. Press 1-9 with an empty search to apply the saved model
and effort. Alt+Shift+F cycles available favourites. Use **Save current** in the
native picker to save the selected model and reasoning. **Edit** reorders or
removes favourites.

BB stores up to nine ordered presets in the server-backed
`modelPicker.favourites` UI preference. The CLI and SDK use the same preference.
The plugin supplies no model button, model menu or model shortcuts.

Deploy this app bundle with a BB build that includes native favourites. Import
existing plugin favourites into BB before reloading the app bundle. Keep the
installed plugin bundle until that core build is active. The model RPCs retain
access to stored favourites for the transfer.

### Accounts

Press **Alt+A** or click the account name in the composer to open the account
picker. It opens with the current account focused. Press **1-9** to select an
account, or use **Up / Down** and **Enter**. **Escape** returns to the draft.
Numbers follow the account list order, not quota rankings.

Each account shows usage, elapsed time and reset times for its allowance windows.
The filled bar marks allowance used. The vertical line marks time elapsed.
Pace compares usage with even spending across the window. Stale readings are
striped and omit pace projections. **Refresh** reloads readings; new-thread
readings use the host's quota cache. Failed switches keep the picker open with
the refusal. Successful switches confirm the account and return focus to the
draft without changing the model or effort.

A thread reads quota on its own machine. A new-thread draft reads it on the
connected machine that lists its accounts. Account comparison remains available
during a turn; switching requires an idle thread with no queued messages.

New thread:

1. Click the account status, or run **Switch Claude account** with the caret in the composer.
2. Choose an account with its number or **Up / Down** and **Enter**.
3. Send the first message. The thread starts on that account.

The new-thread choice is remembered, like the model picker. A new Claude thread
starts on it until you choose another, unless another thread starts it. See the
[new-thread rule](#new-thread-rule).

Existing thread:

1. Finish or stop the turn. Clear queued messages. Account switching is disabled during a turn.
2. Press **Alt+A** and choose an account.
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

Grok quota comes from the native CLI billing extension. Its allowance is shared
across Grok products. The overlay shows the reported period, use and reset.
Collection uses native CLI authentication and sends no model prompt.

Amp presents the native `amp usage` account and credit balances as labelled
amounts, with a link to credit settings. Unrecognised provider text stays visible.
The overlay requests Amp and quotas in parallel. Quotas appear as soon as they
are ready; Amp stays below them. The refresh indicator tracks both requests.
Refresh requests a new reading; a failed refresh retains the previous text with the failure.
Balances have no invented percentage or pace projection.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Open native model picker | Alt+F |
| Next native favourite | Alt+Shift+F |
| Previous native favourite | Assign modelPicker.cycleFavouriteBackward in BB keyboard settings |
| Select favourite 1-9 | 1-9 inside the native picker |
| Open account picker | Alt+A |
| Show usage | ⌘⇧A |

Inside the native picker, Up and Down move through favourites and models.
Enter selects the highlighted row. Digits select favourites when search is empty.
Escape closes the picker. Reasoning controls remain below the model list.

Inside the account picker, Up and Down move between accounts. Enter or 1-9
selects an account. Escape returns to the composer.

## New-thread rule

A thread that another thread starts takes that thread's account, Default
included:

- A child created with `--parent-self`, `--parent-thread` or an SDK
  `parentThreadId` takes its parent's account.
- A fork takes its source thread's account. A fork of a thread with no
  account chosen stays on Default, where BB writes the forked session.
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

`src/accounts/` owns bindings, routing, the guard, transcript handover, quota
and usage. The account picker and usage overlay call the typed account RPC.
`src/models/` exposes stored plugin favourites for migration to BB's native
preference. It supplies no composer controls.

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
caches successful measurements for five minutes and failures for one minute.
The header badge and the RPC handlers share that cache. Refresh requests bypass
it. Paid extra usage is outside the subscription quota display.

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
```

`overview` and `header` print the usage overlay and header data as JSON.

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

Requirements: BB 0.46+, Plugin SDK 0.6.37, Node 24+, pnpm, native Claude Code.
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
favourites with saved effort, the picker and the usage views.
The disposable live proof is documented in [SPIKE.md](./SPIKE.md).
