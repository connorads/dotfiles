# Handsfree

Hex voice commands control the focused BB window. A Voice header control shows brief
results and retains failures. Clicking opens activity, command help and numbered matches.
New drafts provide the same control beside the composer actions.

## Command pedal

The left pedal sends F18. Focus BB, hold the pedal, speak a command, then release.
The Voice header shows recording feedback and the recognised text. Thread, project
and model searches select a single match directly. Multiple matches offer choices
in BB. Select with a click, Enter or "choose two".
Other commands use the same BB actions as always-listening Hex commands.
The centre pedal remains Right Option for dictation; the right pedal remains Enter.

The recorder uses Hex's selected microphone and local dictation model. Hex must
be running. Hex suppresses its command recogniser during programmatic recording;
always-listening commands resume afterwards. Changing apps cancels recording.
Changing the BB thread or project rejects the recorded command. Recordings cancel
after sixty seconds. Escape cancels a held recording.

Install or rebuild from this directory with `pnpm pedal:install`. The installer
builds `~/Applications/Hex Command Keys.app` and installs the login service
`local.bb.command-pedal`. Enable that app in macOS Input Monitoring. Keyboard
navigation and popup dismissal also require System Events Accessibility permission.

The login service launches the signed keyboard app, which starts the Bun recorder.
The app sends F18 and Escape events through a pipe to the recorder. Input Monitoring
belongs to Hex Command Keys. Keep Bun disabled in Input Monitoring. Rebuilding the
ad-hoc signed app changes its identity; remove and add the app again if macOS
rejects its saved permission.

```mermaid
flowchart LR
  Launchd[Login service] --> Keys[Hex Command Keys app]
  Keys -->|F18 and Escape events| Recorder[Bun recorder]
  Recorder --> Hex[Hex dictation]
```

- `pnpm pedal:status` shows launchd state.
- `pnpm pedal:restart` restarts the recorder after permission or source changes.
- `pnpm pedal:stop` stops it for this login session. Run `pnpm pedal:install` to enable it again.

The login service runs independently of agent sessions and restarts after failure.
Reinstall after changing the Bun runtime path. Its logs are
`~/.local/state/hex/pedal.log` and `pedal-error.log`. Shared command outcomes use
`voice.jsonl`. Logs contain recognised speech. The temporary browser helper is
not required.

## Use

1. Enable Commands in Hex. Release the Right Alt dictation pedal before speaking a command.
2. Say `open BB`, then `voice help`.
3. Say a command from the card. Hold Right Alt to dictate task text.
4. Release Right Alt, wait for the text, then press the Enter pedal to send.

| Say | Action |
| --- | --- |
| `go to the login thread` | Match a thread by title and project |
| `next thread` / `previous thread` | Use BB's configured navigation shortcuts |
| `next unread` | Open the oldest unread stopped thread, including text questions and errors |
| `show threads` | Show up to nine recently updated threads as numbered choices |
| `show git` / `show usage` | Open Git status for the selected thread or usage for all agent accounts |
| `close popup` / `close pop up` / `close voice monitor` | Close voice controls and send Escape to dismiss the top popup |
| `who needs me` / `next waiting` | Show threads with pending questions or approvals |
| `next finished` | Show unread successful results |
| `new thread` | Open a draft in the selected project |
| `focus chat` / `focus message` / `focus composer` | Focus the selected chat input for dictation |
| `show projects` / `list projects` | Show numbered draft projects |
| `select project kb` / `switch project to kb` | Change the draft's project or open a draft from a conversation |
| `new thread in dotfiles` | Match a project and open its draft |
| `use Sonnet` | Match a model across available providers |
| `show models` / `change model` / `switch model` | Show numbered models across available providers |
| `show favourites` / `use favourite two` | List saved models or select a slot with its saved effort |
| `show accounts` / `use account work` | List Claude accounts or select one by name |
| `choose two` | Select a numbered voice match or native question answer |
| `voice help` | Open the monitor command list |
| `voice monitor` / `voice history` / `show voice` | Open recognition, dictation and BB activity |
| `archive this thread` / `archive thread` | Archive the selected thread |
| `confirm archive` / `cancel archive` | Answer an archive confirmation |
| `unarchive last thread` / `restore last thread` | Restore the most recent voice archive |
| `allow once` / `allow for session` / `deny approval` | Answer the selected thread's single pending approval |

Approval commands resolve through BB's interaction API with the same grants as the card's buttons.
Several pending approvals, plan approvals and unavailable decisions are rejected; use the buttons.

"Choose" selects from visible voice matches or the focused pane's native question.
Voice matches own their numbers until dismissed. Selecting an answer keeps the
question open; submit it separately. Hidden, disabled and ambiguous questions
reject selection. An unrelated popup blocks selection.

The command pedal captures the choice target when recording starts. Changed
questions, options or voice matches reject the recording. A recording selects
once. Separate commands can toggle multiple answers.
Completing a focused question returns focus to the composer. Intermediate pages
and failed submissions keep question focus. Moving focus elsewhere cancels the return.
Choices take keyboard focus. Enter selects the highlighted match while the card
has focus. Returning to the composer restores BB's Enter and arrow keys.
Escape closes
the card and restores composer focus. Q also closes when the card has focus. Outside the card, BB handles both pedals.
Routine results appear in the header for four seconds. Failures stay visible
until another command succeeds. Choices and archive confirmation open temporary prompts. Completing or cancelling
a prompt closes it. A monitor opened explicitly stays open when a prompt completes.
Requested help opens the command list. Failures remain available in Activity without opening it automatically.

`take me to …` and `can I go to …` also search threads. `next conversation` and
`previous conversation` also navigate. Use `next thread` or `go to next thread`
without `the`. Hex can reject `go to the next thread` as an ambiguous command
sequence because `go to the` is itself a valid captured command.

`create new thread`, `start new thread`, `create a new thread` and
`start a new thread` also open drafts. Each accepts `in …` to select a project.
`change model to …` and `switch model to …` also select models.
`list models` also lists models. `what can I say` and `what can I say here`
also open command help. These phrases work through both Hex and the command pedal.

Project selection changes the current draft through BB's project picker, preserving
its text, mentions and attachments. BB can refuse the switch during uploads or
attachment copying. From an existing conversation, selection opens a new draft;
it does not move the conversation. Navigation replies report the draft opening;
project changes report success after BB confirms the selected project.

Voice commands follow the focused split pane. `focus chat` places the caret at
the end of its draft without submitting. A blocking popup requires `close popup`
first. Say `open BB` to activate the application before focusing its chat input.
The monitor keeps fifty recent BB results in memory, including heard search targets.
Reloading clears this history. Hex's diagnostic logs have separate retention.

Activity reads the latest 256 KiB of Hex's `live.ndjson` on the BB server every
750 ms. It shows the last capture state, transcript, and fifty native attempts.
Recording and transcription feedback expires after thirty seconds without a
state update. This file records events; its presence does not prove Hex is running.
Unmatched speech appears only when requested and does not count as a failed command.
Each attempt exposes the heard text, matched command, context and result.
`Handler returned` records Hex's handler outcome. BB action results appear separately.
Missing or unreadable logs show `Hex diagnostics unavailable on this BB server`.

The monitor opens beside the header or draft control. It is an in-app surface.
A detached desktop window requires support from BB's desktop window API.
Navigation requests report the observed destination when the selected thread changes.
The header confirms only spoken navigation. Clicks and shortcuts log their destination in Activity.

Each spoken BB request writes one outcome to `~/.local/state/hex/voice.jsonl`.
Search records include heard words, matching method, candidate choices, Jev
answers and scores, and timing. Failed searches record `no-match`; timeouts
record `error`. Navigation records `requested` until the window changes.
BB diagnostics record observed destinations with the command request ID.
An observation expires after three seconds; a missing observation does not
prove that navigation completed.

Idle threads archive immediately. Running or queued work and child threads require
confirmation. Changing the selected context or issuing another action cancels
the pending confirmation. Recording feedback and context checks preserve it. Archive targets the selected thread without title matching.

The server retains ten voice archives across plugin reloads. Repeated restore
commands reverse those archives in order. Each restore includes the threads that
BB archived with the parent. Partial restores retain the remaining threads for retry.
If saving recovery fails after an archive, the server keeps it in memory and
asks you to restore before closing BB. Unavailable storage blocks new archives.
Restoration opens the conversation; it does not restart stopped work or restore
retired workspaces. BB keeps running turns and terminals for a 30-second archive grace period.

Model selection changes the next message. Selecting another provider uses BB's
handoff flow. BB adds the handoff context to the draft; the next send starts the
destination thread. Selection does not interrupt a running turn or submit text.
Favourites apply Agent Switcher's saved model and effort. Their spoken slot
numbers remain stable when another favourite is removed. Numbered list choices
follow the displayed order; `use favourite two` refers to saved slot two.

Account selection reuses Agent Switcher's Claude account transfer. It requires
an idle thread without queued messages. A new draft remembers its choice for
the next Claude thread. A provider handoff must send its first message before
account selection becomes available. Codex account selection is unavailable.
See [Agent Switcher](../claude-profiles/README.md#accounts) for account ownership.
The thread matcher offers the 200 most recently updated visible, unarchived
threads. Attention lists show up to nine threads.

`next unread` skips the selected thread, archived and hidden threads, and ongoing
work. It uses BB's unread state and orders replies by attention time, oldest first.
Opening a thread follows BB's read behaviour; it does not archive the conversation.

`show git` and `show usage` use the existing header buttons. Repeated commands
keep the view open. Missing controls report that the view is unavailable.
`close popup`, `close pop up` and `close voice monitor` close voice controls and send Escape through Hex. BB and the
focused popup own dismissal and focus restoration. Nested popups close one layer
at a time.

Thread searches compare titles separately from project and provider labels.
Literal thread searches also compare joined words, so `kbsync` matches `KB sync`.
Clear literal matches navigate immediately. Reordered words, singular/plural
forms and one small spelling error offer up to three matches.
Approximate matches require at least two words and one exact word. They
navigate automatically when only one match remains. Multiple matches require
selection. Descriptions without close word matches use Jev.

```mermaid
flowchart LR
  Hex[Hex command] --> Bridge[Focused BB window]
  Bridge --> Choices[Live thread, project or model choices]
  Choices --> Match[Hex exact match or Jev decision]
  Match --> Action[BB navigation or composer selection]
  Match --> Card[Numbered choices]
  Card --> Action
```

## Install and verify

Run from `~/src/bb-plugins`:

```sh
pnpm install
pnpm --filter bb-plugin-handsfree test
pnpm --filter bb-plugin-handsfree typecheck
pnpm --filter bb-plugin-handsfree build
bb plugin install path:~/src/bb-plugins/handsfree
```

After edits, build the plugin and run `bb plugin reload handsfree`.

## Local command interface

Hex invokes the installed BB CLI with a JSON command. The CLI waits for the
focused window's reply. It does not depend on a fixed HTTP port.

`POST /api/v1/plugins/handsfree/http/command` provides the same interface for
local testing. BB's local HTTP authentication rejects untrusted browser origins.

```sh
bb handsfree command '{"action":"help"}'
bb handsfree command '{"action":"list","kind":"model"}'
```

The command schemas live in [contracts.ts](contracts.ts).
List kinds are `thread`, `project`, `model`, `account` and `favourite`.
Model candidate IDs encode the provider and model together. Clients return the
opaque candidate ID without constructing it. List replies carry a context identifier. Selection and choice requests must
return it unchanged. A changed thread, project, provider or machine rejects stale choices.
Only one window claims each request. Unclaimed requests expire without replay;
plugin reload cancels pending requests. No focused window produces an explicit error
after 1.5 seconds. A window busy with another command rejects the new one.

Tests cover command ownership, expiry, stale context, drafts, model selection,
attention filters and pedal behaviour. Live checks cover BB navigation and the
Hex command registry. Spoken recognition requires a microphone check.
