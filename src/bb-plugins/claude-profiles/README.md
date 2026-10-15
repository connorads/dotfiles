# Agent Switcher for BB

Choose the model, its effort and the Claude Code account for a thread from one
picker. Keep the native conversation when switching accounts. Show each
account's quota in the thread header and in an all-account overlay.

The plugin ID is `claude-profiles`, so its CLI is `bb claude-profiles`. BB
shows it as **Agent Switcher**. [ADR 0001](../docs/adr/0001-consolidate-agent-switcher.md)
records why it absorbs Model Favourites and Agent Usage.

## Use

### Picker

Press **Alt+F**, click the chevron beside the prompt star, or choose **Switch
model** in the composer's plus menu. The picker opens on the focused composer, in a thread
or a new-thread composer. It changes the next turn and keeps the draft. It never
sends a prompt.

This picker works with standard BB. BB's native model selector remains visible
alongside the plugin controls.

1. Search by model or provider. Filter with the chips under the search field:
   **All**, **Favourites** or one provider.
2. Click a model to select it. Click its star to save or remove it as a
   favourite. The star shows on hover or focus until the model is a favourite.
3. Set the effort and tier for this turn in the **Now** strip. It shows the
   current model and only the efforts and tiers that model supports.
4. Choose the Claude account in the **Claude account** menu. It shows while
   Claude Code is the selected provider.

The list shows **Favourites** first, then one section per provider. A
favourite row shows its slot number and its saved effort. The selected row has
a check. An unavailable row is dimmed and shows the reason.

### Favourites and effort

The star beside the prompt shows whether the current model is a favourite. It
is filled gold when it is. Click it to save the current model with the current
effort, or to remove it. Its tooltip names the model and effort.

Up to nine favourites fit in numbered slots. Removing one leaves the other slot
numbers unchanged. Each favourite has a **Saved effort** pill. Click it to choose
**Default** or an effort the model supports. With a favourite row focused,
Left and Right step the saved effort.

| Case | Behaviour |
| --- | --- |
| Saved effort that the model supports | Selecting the favourite sets that effort. |
| Saved effort that the model no longer supports | The row is disabled with the reason. Its pill shows **(unavailable)** in amber and stays editable. |
| No saved effort (**Default**) | Selecting the favourite uses the model's default effort, not the composer's current one. |
| **Now** effort changed | Only this composer changes. Saved efforts stay. |

Cycling skips disabled favourites. A favourite whose provider is unavailable on
this machine stays visible with a reason. Favourites persist in plugin storage
and update across open views.

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

Account selection in a cross-provider handoff is unavailable before its first
message. The picker explains this limit. New Claude threads use the remembered
account; switch accounts after the first message. Alt+A does nothing in queued
or sent-message editors and does not change the remembered account.

**Default** means the thread has no named account. It uses the native default
configuration.

Profiles come from `~/.claude-profiles/code/` on the thread's host. Plugin
settings accept another profile root and Claude executable.

### Usage

The thread header shows the limit most likely to stop the thread. A ring shows
its use. The text adds the run-out or reset time when the window needs
attention. Hover over it for every window. A Claude thread shows its bound
account's quota.

Click the badge or press `⌘⇧A` to open the usage overlay. It groups every
account by provider, and by machine when more than one reports. Each window is
one row: its bar, use and time to reset, or its run-out time when use will
outlast it. Hover over that text for the full reset time. **Refresh** requests
fresh readings. Codex reset credits show beneath the Codex accounts.

A Claude profile row shows the account email and plan cached in the profile's
`.claude.json`. Team seats read as Team Standard or Team Premium with the
premium multiplier.

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

Expired or signed-out Claude accounts show **Sign in again**. The button opens
**Claude sign-in**, a BB page with a terminal on that account's machine. Complete
the native browser login there. Default uses the machine's native configuration;
named accounts use their profile directory. Concurrent clicks reuse the active
login terminal. Offline accounts require their machine to reconnect first.
Successful login refreshes usage and reopens the overlay. Failed login keeps the
terminal available with **Try again**. The **Claude sign-in** sidebar page also
provides **Agent usage** to return to the account list.

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
| Open model picker | Alt+F |
| Next favourite | Alt+Shift+F |
| Previous favourite | Assign in BB keyboard settings |
| Select favourite 1-9 | Assign in BB keyboard settings |
| Open account picker | Alt+A |
| Show usage | ⌘⇧A |

Inside the picker:

| Action | Key |
| --- | --- |
| Move between models | Up / Down |
| Select the focused model or first search result | Enter |
| Select a favourite slot | 1-9 when search is empty, or outside the search field |
| Step the focused favourite's saved effort | Left / Right |
| Star or unstar the focused model | ⌘S or Ctrl+S |
| Close the open effort or account menu | Escape |
| Close and return to the composer | Escape, or Q outside text fields |

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
caches successful measurements for five minutes and failures for one minute.
The header badge and the RPC handlers share that cache. Refresh requests bypass
it. Paid extra usage is outside the subscription quota display.

The plugin also implements BB's discoverable `provider-usage.v1` source contract.
An enabled Provider Usage panel can list these profiles and request individual
measurements. Each resource belongs to its BB host. Listing reads directory
metadata and never requests quota. The plugin does not enable that panel or change
its other sources.

Codex reset credits come from `~/.cache/codex-usage.json`. Opening the overlay
refreshes missing readings or readings at least five minutes old. The open
overlay checks every five minutes. Collection runs
`~/.config/zsh/functions/codex-usage` with its cache, lock and backoff rules.
No tmux session is required. The plugin does not read credentials or redeem credits.

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
send resolves the choice on the thread's own host. A switch copies the parent
transcript and its session directory, including subagent history and tool results.
Existing JSONL files must match or extend the target at a complete line boundary.
Other existing files must match exactly. Target-only files and conflicting
metadata stop the switch without overwriting the conflicting history.

The transfer refuses symlinks and special files. Limits are 64 MiB per file,
256 MiB per session and 4096 files and directories. The runtime must be idle.
Files are staged and both histories are checked again before publication.
Child files are published before the parent transcript. An interrupted transfer
can leave some child files updated; retrying completes a compatible transfer.
The copy is not a filesystem transaction or a lock against external writers.
Credentials and settings stay in their own profiles.

```mermaid
flowchart LR
    Idle[Stop runtime] --> Snapshot[Read session files]
    Snapshot --> Check[Reject conflicts]
    Check --> Stage[Stage and recheck]
    Stage --> Children[Publish child files]
    Children --> Parent[Publish parent transcript]
    Parent --> Bind[Save profile selection]
```

BB's Claude bridge copies a
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
continuation, quota parsing, control requests, cancellation, the new-thread rule,
favourites with saved effort, the picker and the usage views.
The disposable live proof is documented in [SPIKE.md](./SPIKE.md).
