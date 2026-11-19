# Agent Switcher for BB

Choose the model, its effort and the Claude or Antigravity account for a thread from one
switcher. Claude account changes keep the native conversation. Show each
account's quota in the thread header and in an all-account overlay.

The plugin ID is `claude-profiles`, so its CLI is `bb claude-profiles`. BB
shows it as **Agent Switcher**. [ADR 0001](../docs/adr/0001-consolidate-agent-switcher.md)
records why it absorbs Model Favourites and Agent Usage.

## Use

### Switcher

Press **⌘⇧M**, click the model chip in the composer, or choose **Switch model**
in the composer's plus menu. The switcher opens on the focused composer, in a
thread or a new-thread composer. It changes the next turn and keeps the draft.
It never sends a prompt. Queued-message editors cannot open it.

The plugin hides BB's own model, effort and mode trigger in the composer, so
the chip is the only model control. No SDK slot hides just that trigger, so a
content script adds one CSS rule matched to BB 0.49's composer markup. A BB
markup change brings the native trigger back beside the chip; it hides nothing
else. Disabling the plugin removes the rule.

```text
 [low|medium|high]  Fast        ⌁ Connectors off
 ────────────────────────────────────────────
 1  ◎ Sol            ●○○        ★
 2  ✳ Opus           ●●○   ✓    ★
 3  O DeepSeek Flash ●○○        ★
    + Add model…
 ────────────────────────
  (S) Summit  (T) Trove  ...   account row
 ────────────────────────
  ⌕ All models            /
```

| Key | Action |
| --- | --- |
| **1-9** | Use that favourite |
| **Up / Down** | Use the next or previous favourite |
| **Left / Right** | Lower or raise the effort |
| A letter | Use the account with that letter |
| **⌘S** | Star or unstar the current model |
| **/** | Search every model |
| **Enter** or **Escape** | Close, also while a change still runs; a later failure shows as a notification. **Enter** on a button reached with **Tab** presses it instead |

One change runs at a time per composer. A change that takes a moment dims the
switcher and names itself, such as **Switching to Trove…**. Reopening the
switcher while it runs shows the same change and accepts no second one.

Each row shows its slot, provider, name and effort as dots, one per level the
model supports. **auto** means the model's default effort. A model supplied
by an unavailable provider is dimmed; hover over it or press it for the reason.

The current model leads the list when it is not a favourite. Its **☆ Keep**
button, or **⌘S**, saves it as a favourite. Each favourite's **★** removes it.
**Add model…** opens search. Pressing the current row closes the switcher and
leaves its effort as it is.

The top strip shows one effort segment per supported level and the speed tiers
BB reports for the current model. A single speed tier appears as a toggle.
Multiple tiers appear beside **Default**. The composer chip names the active
speed tier when it differs from **Default**.

The strip also shows **Daybreak** when available and a **Connectors** switch
for the shown Claude account. The switch writes the same preference as the
settings section.

On a touch screen every control is at least 44 px. On a phone-width touch
screen the switcher opens as a sheet at the bottom of the window. A tap on the
dimmed backdrop closes it.

The account row shows when the current provider has more than one account.
Each account shows its letter inside a ring. The ring fills with the fullest
allowance window. It turns amber at 70% and red at 90%. Hover for each window.
**⌁** marks an account whose connectors are on.

#### Search

Type to filter by model, provider or route, such as **OpenCode Go**. **Up /
Down** moves, **Enter** uses the highlighted model and **⌘S** stars it.
**Escape** or the **‹** button returns to the favourites. A provider whose catalogue fails shows
only when you search for its name. The catalogue does not verify account
access; Go plan and workspace settings apply.

### Antigravity accounts

Antigravity offers **Default** and registered isolated accounts in the account row.
Default keeps the native login and configuration. Isolated accounts use private homes.
Choosing an account preserves the selected model and draft. It sends no prompt.
Account changes require an idle thread. BB performs its normal provider handoff when the account route changes.
Native Antigravity conversation continuity across account routes is not guaranteed.
Models unavailable on the target account prevent the change.
Favourites include their account route, so a favourite selects its account too.

```mermaid
flowchart LR
  Selection[Selected account] --> Route[Account ACP route]
  Route --> Launcher[Mandatory profile launcher]
  Launcher --> ACP[Thread and native workers]
  Launcher --> Models[Model discovery]
  Launcher --> Usage[Quota collection]
```

Each isolated account has a stable provider ID, `acp-antigravity-profile-NAME`.
Keep that ID when changing its display name. BB threads and favourites store the ID.
Default retains `acp-antigravity`.

Set display labels independently of profile paths and provider IDs:

```sh
bb plugin config claude-profiles set antigravityAccountLabels '{"default":"first@example.com","secondary":"second@example.com"}'
```

The switcher and Agent Usage use these labels. They are explicit names, not automatic login detection.
Update a label after signing a profile into another account.
Store private labels in BB settings, outside tracked managed configuration.
Account shortcut letters stay stable when labels change.

The account row shows a stable letter and a ring for the fullest quota window.
Agent Usage groups the accounts under Antigravity and caches each account separately.
An authentication failure offers **Sign in again** through the same account launcher.

Create and enrol an account on the machine running its threads:

```sh
profile="$HOME/src/bb-plugins/claude-profiles/bin/agy-profile"
"$profile" create example
"$profile" example acp --login
```

Add the account to `provider-acp.customAgents` in the
[managed settings](../../../.config/bb/plugin-config.json), preserving existing entries:

```json
{
  "id": "antigravity-profile-example",
  "displayName": "Antigravity · Example",
  "command": "zsh",
  "args": [
    "-c", "exec \"$HOME/src/bb-plugins/claude-profiles/bin/agy-profile\" example \"$@\"",
    "agy-profile", "acp", "--process-per-session"
  ]
}
```

Run `bb-plugins apply` and verify `bb provider models acp-antigravity-profile-example --json`.
Account creation and registration use these commands. There is no Add account form.
To remove an account, first move its threads and favourites to another route.
Remove its managed registration and run `bb-plugins apply`.
After closing its CLI processes, use `trash` on its directory under `~/.local/share/agy-profiles/`.
Never remove Default's native credentials as part of isolated account removal.

The launcher requires macOS and Antigravity 1.5.9.
It resolves global mise tools before changing `HOME` and preserves the workspace directory.
A missing profile or unsupported CLI version stops the launch without using Default.
Its sandbox blocks Keychain access, the native `.gemini` directory and other existing profile directories.
Native authentication owns credential creation and refresh. The plugin does not parse or copy tokens.
The file-storage fallback uses an undocumented cache marker and `WSL_INTEROP=1`.
Version upgrades require renewed isolation checks before changing the launcher's version guard.
Private `HOME` also changes user settings, skills, shell configuration and tool credentials.
The launcher does not link the real home into a profile.
Token refresh and logout independence require further live verification.

### Favourites and effort

Up to nine favourites fit in numbered slots. Removing one leaves the other slot
numbers unchanged. **Alt+1-9** uses a favourite without opening the switcher.
While a switcher change runs, it shows a notification and changes nothing.

A favourite remembers the last effort and tier used with it. Changing either
while a favourite is current saves it to that favourite.

| Case | Behaviour |
| --- | --- |
| Remembered effort that the model supports | Selecting the favourite sets that effort. |
| Remembered effort that the model no longer supports | Selecting the favourite uses the model's default effort. |
| No remembered effort | Selecting the favourite uses the model's default effort, not the composer's current one. |
| Remembered **Fast** the model no longer offers | Selecting the favourite uses the default tier. |

Favourites persist in plugin storage and update across open views.

### Daybreak

Search **Daybreak** to find the models that advertise the programme. Each result
names the model and **Daybreak**. Selecting it sets the model and programme for
the next turn. Models that require Daybreak off have no Daybreak result. In a
thread, the **Daybreak** toggle on the current row switches the programme.

A favourite saves its Daybreak setting with the model. Standard and Daybreak
choices for the same model can occupy separate slots. Selecting a favourite
checks that its model supports its saved programme before changing the thread.

BB's composer SDK cannot read or set session options before thread creation.
New-thread drafts use BB's native model picker for Daybreak. Save and apply
Daybreak favourites after starting the thread. A cross-provider handoff must
reach Codex before a Daybreak favourite can apply.

### Account connectors

Connectors are apps connected through a Claude account, such as Slack. Each
saved account has one connector preference on its machine. Accounts start off.
Executor keeps its own connection control.

| Control | Choices | Where |
| --- | --- | --- |
| Account | Off / On | **Claude account connectors** in Agent Switcher's settings, or the switcher's **Connectors** switch |
| Thread | Use account setting / Off | `bb claude-profiles connectors THREAD` |

A thread can restrict access but cannot enable an account that is off.

```mermaid
flowchart LR
  Account{Account allows?} -->|Yes| Thread{Thread allows?}
  Thread -->|Yes| On[Connectors on]
  Account -->|No| Off[Connectors off]
  Thread -->|No| Off
```

Account changes recalculate access. Forks copy the thread restriction; child
threads start off. New threads follow account settings. Draft account changes
configure the saved profile rather than a one-shot new-thread choice.

A policy change stops affected idle sessions and preserves queued messages. A
running turn keeps its launch access; its restart waits until the thread is
idle. The next message that starts a turn waits with **Applying connector
settings…** while the session stops beside the dispatch hook, then proceeds.
A steer into the running turn proceeds unchanged. Pending restarts persist
across plugin reloads. A thread restriction change requires an idle thread with
no queued messages or background agents.

The composer marks **connectors still on** when an old launch still allows
access that the current policy blocks. Claude settings and organisation
policies can also block access requested at launch. Masked launch values remain
unknown and require a restart before another send.

The [BB-wide default](../../../docs/bb.md#claude-account-connectors) must be
provisioned on each BB server. It keeps connectors off for new processes even
if Agent Switcher is unavailable. The switch leaves profile, project and plugin
MCP servers available.

Existing thread choices migrate when read. Off remains a thread restriction;
On follows account settings without enabling an account. The legacy decoder
can be removed after every stored `connectors:` entry has a `mode` field.

```sh
bb claude-profiles connectors THREAD
bb claude-profiles connectors THREAD account
bb claude-profiles connectors THREAD off
```

### Accounts

Press the account's letter in the switcher, or click it. Letters stay with
their accounts; see the sidebar badges below.

A thread reads quota on its own machine. A new-thread draft reads it on the
connected machine that lists its accounts.

New thread:

1. Open the switcher and press the account's letter.
2. Send the first message. The thread starts on that account.

The new-thread choice is remembered. A new Claude thread starts on it until
you choose another, unless another thread starts it. See the
[new-thread rule](#new-thread-rule).

Existing thread:

1. Open the switcher and press the account's letter.
2. Send the next message. Claude resumes the same native conversation.

During a turn the account shows **next turn**. The switch runs when the turn
ends. Choosing the current account again cancels it. The next message waits
with **Moving to <account>…** until the conversation transfers.

Account selection in a cross-provider handoff is unavailable before its first
message. The switcher says so. New Claude threads use the remembered account;
switch accounts after the first message.

**Default** means the thread has no named account. It uses the native default
configuration.

In the sidebar, a Claude thread on a named account shows the account's letter
on its Claude icon. Each account keeps one letter and one colour. The letter is
the first letter of its name that no earlier account holds, so a new account
never changes an existing letter. Hover over the row's icon for the account
name. Threads on Default show no letter. The badge decorates BB's
own thread list by DOM selector, so a BB markup change can hide it; see
[SDK frictions](../docs/sdk-frictions.md).

Workflow previews and the right panel show each named Claude account beside the worker's
model details, using its sidebar colour. The label follows the worker thread's
binding. Run data refreshes every five seconds while the page is visible.
Default and unbound accounts have no label. Duplicate worker labels within one
run have no account label because the rendered rows expose no worker ID.
The panel resolves its shortened run ID from active runs or recorded preview
directives, including when the inline card is outside the rendered chat.
Both views use the same decoration and preserve worker navigation.

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
fresh readings. A light sweep marks pending requests. Changed figures roll into
place with their bar fills when readings arrive. Reduced motion disables these
animations. Saved resets show beneath their account's quota rows. Claude groups
them by reset type and expiry; Codex groups its reset credits by expiry. Deadlines
within three days show in amber. Hover over an expiry for its date and local time.
Held Claude resets stay visible when they are paused or cannot be used yet.

Claude adds limits without notice, often under internal codenames. A Claude account
lists **Unread usage fields** when Claude reports a field with a value that
[quota.ts](src/accounts/quota.ts) neither reads nor ignores on purpose. A limit may be
missing from that account. Read the field or add it to the parser's ignore list.

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

Expired or signed-out Claude and Codex accounts show **Sign in again**.
OpenCode shows **Connect Go**. The button
opens **Agent sign-in**, a BB page with a terminal on that account's machine. Claude
runs `claude auth login`. OpenCode runs
`opencode auth login opencode --method device`. Open its terminal link in a
browser on any device, choose the Go workspace and approve the code. Credentials
stay on the selected machine, including when it is a remote server. Claude Default uses the machine's native configuration;
named accounts use their profile directory. Codex uses the machine's one CLI login
and starts `codex login --device-auth`: open the printed link on any device and
enter the code. Device codes need device code sign-in turned on in ChatGPT security
settings. **Use browser instead** switches to `codex login`, whose callback reaches
only a browser on the account machine. Switching closes the running Codex login.
Concurrent clicks reuse the active login terminal. Offline accounts require their machine to reconnect first.
Successful login refreshes usage and reopens the overlay when usage is available.
OpenCode reports successful authorisation independently of the allowance check.
If Go usage is unavailable, the sign-in page offers **Open Go usage in Console**
and **Refresh Go usage** without starting another sign-in. An unavailable Go
allowance does not establish that OAuth failed. Failed login keeps the
terminal available with **Try again**. The **Agent sign-in** sidebar page also
provides **Agent usage** to return to the account list.

The overlay reads BB's built-in **Provider usage** plugin. Enable it for
providers other than Claude.

Grok quota comes from the native CLI billing extension. Its allowance is shared
across Grok products. The overlay shows the reported period, use and reset.
Collection uses native CLI authentication and sends no model prompt.

Antigravity quota comes from `agy --print /usage --output-format json` on the
account's machine. Native sign-in owns authentication; collection sends no model prompt.
The overlay preserves each quota group and its five-hour or weekly period.
Successful readings last two minutes; Refresh bypasses the cache.
Failed refreshes leave the collector's previous reading visible with an error.
The CLI omits account identity from this response, so the account has no email label.
The thread badge has no exhaustion estimate because model-to-quota membership is unavailable.

```mermaid
flowchart LR
  CLI[Native Antigravity quota] --> Host[Host collector]
  Host --> Source[BB usage source]
  Source --> Overlay[Agent Usage]
```

Amp presents the native `amp usage` account and credit balances as labelled
amounts, with a link to credit settings. Plain text and Markdown balance labels
are supported. Recognised billing help is omitted; warnings and unrecognised
provider text stay visible.
The overlay requests Amp and quotas in parallel. It shows fresh quotas while
Codex and Claude reset details finish loading. Amp stays below the quotas.
The refresh indicator stays active until all readings finish.
Collection waits for every source older than two minutes, which can take
several seconds. The plugin saves the last collected quotas, so the first open
shows them with **Refreshing…** until collection finishes.
Refresh requests a new reading; a failed refresh retains the previous text with the failure.
Balances have no invented percentage or pace projection.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Open the switcher | ⌘⇧M |
| Use favourite 1-9 | Alt+1-9 |
| Show usage | ⌘⇧A |

BB's own model picker also defaults to ⌘⇧M. A default that conflicts stays
unbound, so the dotfiles BB preferences unbind BB's model picker shortcuts and
bind ⌘⇧M to the switcher. Keys inside the switcher are listed under
[Switcher](#switcher).

## New-thread rule

A thread that another thread starts takes that thread's account, Default
included:

- A child created with `--parent-self`, `--parent-thread` or an SDK
  `parentThreadId` takes its parent's account.
- A fork takes its source thread's account. A fork of a thread with no
  account chosen stays on Default, where BB writes the forked session.
- A workflow worker takes the account of the run's origin thread. A worker
  of a Claude origin with no account chosen stays on Default, where the
  origin runs.
- A parent that never had an account chosen, a non-Claude parent or workflow
  origin and a `bb thread spawn` without a parent use the remembered composer
  choice.

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
    Host->>Host: Report conflicting history; copy atomically
    Plugin->>Plugin: Persist thread profile selection
    Plugin->>Host: Release the source copy
    Host->>Host: Remove it if the target holds every file unchanged
    User->>Claude: Next message through BB
    Claude->>Claude: Resume session under selected config directory
```

The plugin has two modules. `src/accounts/` owns bindings, routing, the guard,
transcript handover, quota and usage. `src/models/` owns favourites and their
saved effort. The switcher and the usage overlay in `ui/` own no data. They call
the modules through the plugin's typed RPC.

The server owns thread selection and checks BB state. The host worker owns local
directory discovery, transcript copying, native CLI calls and Codex reset
credits.

The plugin reuses BB's Claude Code provider. It contributes `CLAUDE_CONFIG_DIR`
and clears API-key and alternate-provider overrides for threads on a named
profile. Default and unselected threads receive no environment contribution:
Claude resolves an empty `CLAUDE_CONFIG_DIR` against the working directory.
`HOME` stays unchanged.

`CLAUDE_CONFIG_DIR` hides the shared `~/.claude` config. So before each launch
on a named profile, the host runs the dotfiles
[`claude-profile-materialise`](../../../.config/zsh/functions/claude-profile-materialise)
on the profile directory, as `ccp` does. The profile gets the shared settings,
memory, skills and commands. A host without the materialiser skips this step.
A failure or a run over 3.5 seconds is logged, and Claude starts on the profile
as it is.

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

An account chosen through `choose` while a turn runs or messages wait is stored
as pending. Choosing the current account again cancels it. The switch runs when
the thread's runtime is next idle. A steer into the running turn stays on the
old account. A message that would start the next turn first waits with
**Moving to <account>…** while the transfer runs beside the dispatch hook, then
proceeds on the new account. The hook never holds BB's server-wide dispatch
lock for the transfer. A failed transfer refuses that message once with the
reason and leaves the thread on its old account.

A switch starts a new prompt cache on the target account, so the next request
re-sends the whole conversation uncached. When [Cache Hits](../cache-hits/README.md)
is enabled, the switch marks its chip cold.

Switching copies only the native session transcript. It leaves credentials,
settings and unrelated sessions separate. Returning to a profile advances its
older transcript only when its contents are an exact prefix of the current one.
Claude rewrites workflow state files whole, so the switch replaces a differing
`workflows/*.json` only when the parent transcript has grown past the target's.
Symlink paths and transcripts above 64 MiB cause refusal.

A target copy with history this thread lacks is a conflict. The switcher shows
both copies, with prompt count, last write and last prompt, and offers **Replace**
or **Cancel**. Replace moves the target copy to
`<account>/replaced-history/<project>/<session>-<time>/`, then copies. Claude Code
never reads that folder. To restore a copy, move its files back into
`projects/<project>/`. A queued switch that meets a conflict rejects the next send
and asks you to choose the account again in the switcher.
After the thread binds to the target, the switch removes the source copy, so each
session keeps one copy, in its thread's account. A source copy that differs from
the target copy stays. Transcript files can contain conversation content and tool
results, so the target profile receives that content.

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

Claude saved resets come from `~/.cache/claude-usage.json` and
`~/.cache/claude-usage-<profile>.json`. The same five-minute refresh rules call
`~/.config/zsh/functions/claude-usage`, which owns credentials, locks and backoff.
Named profiles require the standard `~/.claude-profiles/code` root for reset
collection. Quota readings support the configured profile root independently.
The collector requests `cedar_ember=1` with the installed CLI's
`claude-cli/<version> (external, cli)` User-Agent. The API requires that format
to report reset grants; a client refusal stays unavailable rather than zero.
Fable grants return weekly Fable usage and refill the session allowance. Weekly,
full and five-hour resets keep their own labels. Redemption stays in Claude.

## CLI

```sh
bb claude-profiles list THREAD_ID
bb claude-profiles switch THREAD_ID work
bb claude-profiles usage THREAD_ID work
bb claude-profiles overview [--refresh]
bb claude-profiles header THREAD_ID
bb claude-profiles import SESSION_ID|TMUX_PANE
bb claude-profiles next [PROFILE]
```

`switch` queues the account while a turn runs, as the switcher does, and prints
`currentId`, `pendingId` and `conflict`. The CLI never replaces a conflicting copy.
`overview` and `header` print the usage overlay and header data as JSON.
`next` prints the remembered new-thread account and the profiles on the
connected machine. With `PROFILE`, it first sets that account, as the switcher does
in a new-thread composer. Agents use it before a workflow run whose origin
cannot pass on an account.

### Import

`import` continues a Claude Code session from outside BB, such as one in a
tmux pane, in a new BB thread. BB has no API to bind a thread to an existing
session, so the import works in 5 steps:

1. Find the source session. A pane target such as `tri:5.2` resolves through
   the pane's processes and `sessions/<pid>.json`. The session must be idle.
2. Spawn a thread in the BB environment whose path is the session's working
   directory. Its stub turn replies `OK`. The title is the session's AI title.
3. Switch the thread to the profile that holds the source transcript. The stub
   session moves there with it.
4. Copy the source transcript and its session directory over the stub's
   session, with the session ID rewritten.
5. The next message resumes with the full history.

The source is only read, so the original session can continue. The two
histories then diverge. BB renders the timeline from its own events, so the
imported history is in Claude's context but not in the BB timeline. On failure
the error names the stub thread. Archive it and retry.

## Scope

The new-thread switcher lists profiles from the first connected host. The first
send resolves the choice on the thread's own host. A switch copies the parent
transcript and its session directory, including subagent history and tool results.
Existing JSONL files must match or extend the target at a complete line boundary.
Other existing files must match exactly. Target-only files and conflicting
metadata are a conflict, which only an explicit Replace overwrites.

The transfer refuses symlinks and special files. It permits up to 4096 files
and directories. Copying and comparison use bounded buffers without a byte-size
limit. The runtime must be idle.
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

BB's Claude bridge copies a fork's session in its own config directory, which
is Default, not the thread's account. For a fork on a named account, including
a side chat, the dispatch hook first links the account's project directory into
Default as `~/.claude/projects/+bb-fork-stage-<thread>`. The bridge then finds
the source and writes the fork into the account. The plugin removes the link
once the fork has its session or fails, and a five-minute sweep removes links
older than ten minutes. A log warning names a fork that did not land in its
account. If the source session cannot be staged, the fork is refused with the
reason.

Remove the staging when BB's bridge forks with the thread's launch env. Check by
opening a side chat on a named-account thread with staging disabled.
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

Requirements: BB 0.49+, Plugin SDK 0.6.132, Node 24+, pnpm, native Claude Code.
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
favourites with saved effort and Daybreak, the switcher and the usage views.
The disposable live proof is documented in [SPIKE.md](./SPIKE.md).
