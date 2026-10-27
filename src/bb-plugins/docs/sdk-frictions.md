# BB SDK frictions

This file lists gaps in the BB plugin SDK and app that forced a workaround or
blocked a feature. Each entry is a candidate BB feature request.

Add an entry when you find the gap, not at the end of the task. Search this
file first and extend a matching entry instead of adding a duplicate.

Do not record security issues here. This repo is public; report them to BB privately.

## Entry format

```markdown
### <Short name of the missing capability>

- Found: YYYY-MM-DD, <plugin>, SDK <version>
- Wanted: <the user-visible outcome>
- Gap: <what the SDK lacks, with the API names checked>
- Workaround: <what the plugin does instead, with file links>, or "none: blocked"
- Ask: <the smallest SDK change that removes the workaround>
- Status: open | requested <link> | fixed in <version>
- Category: sdk-gap | app-bug | provider | cli | other
- Evidence: <@thread ids, commits or file paths; max about 4>
```

When BB ships a fix, set the status, then delete the workaround in its own commit.

## Open: SDK gaps

### Workflow agents cannot select or show session options

- Found: 2026-10-25, built-in Workflows plugin
- Wanted: Run a workflow worker with Daybreak and see that choice beside its model.
- Gap: `agent()` accepts provider, model and reasoning level but no session options.
  Its worker spawn omits `sessionOptions`; its call view carries no effective option values.
- Workaround: The [pinned Workflows bundle patch](../workflows-patch/README.md) accepts
  provider session options, passes them to a direct worker, and shows their labels.
  Session options are independent of activity. The registry pins independent and combined sets and refuses unknown bundle tuples.
- Ask: Accept provider-neutral `sessionOptions` in `agent()`; validate against the selected
  model, pass them to `threads.spawn`, persist the effective values, and show enabled options
  beside the worker model in both progress views.
- Status: open
- Category: sdk-gap
- Evidence: Stock Workflows source and installed bundle; pinned patch script and
  plugin harness. A live direct worker reported Daybreak enabled, and run history
  recorded the choice and its label.

### Markdown filename autolinks lack the file's working directory

- Found: 2026-10-23, installed BB desktop frontend
- Wanted: Open a Markdown file mentioned by an agent working in a separate worktree.
- Gap: Inline code ending in `.md` or `.markdown` becomes a file link without an existence check.
  Message-relative links use the thread workspace as both `baseDir` and `rootPath`.
  A shell command's working directory does not supply that link's base directory.
- Workaround: [Global BB instructions](../../../.bb/AGENTS.md) require explicit Markdown links with verified absolute destinations on the owning host.
- Ask: Show the resolved destination on missing-file errors and avoid presenting nonexistent filename autolinks as verified files.
  Offer an explicit checkout selection for repairing missing destinations; never silently choose a same-named file in another checkout.
  Explicit destinations remain necessary when a message does not identify a unique working directory.
- Status: open. Path lookup contrast verified through BB's file API; UI click replay remains untested.
- Category: app-bug
- Evidence: Installed `ThreadTimelineNavigationContext-*.js` message routing and `markdown-preview-*.js` inline-code conversion.
  BB file reads returned `ENOENT` for workspace-relative candidates and succeeded for the absolute worktree destination.
  Checked with a synthetic description here; private file names and workspace paths are omitted.

### Split chat viewport has no keyboard focus target

- Found: 2026-10-23, fork, installed desktop frontend, SDK 0.6.49
- Wanted: Scroll a split conversation with PageUp, PageDown and arrow keys after clicking chat text or using Tab.
- Gap: Stock split panes focus a `tabindex="-1"` wrapper when clicking non-focusable chat content.
  The inner `[data-page-scroll-viewport].thread-scrollbar` has no tab stop, role or accessible name.
  Native keyboard scrolling then has no scrollable ancestor of the focused wrapper.
  Fork calls `threads.open({ split })`; its notice overlay does not render conversation content.
- Workaround: [Fork content script](../fork/chat-scroll.ts) adds absent focus and naming attributes only within observed split conversation panes.
  Numbered Conversation labels distinguish the split regions and follow pane order.
  Native browser scrolling handles the keys. Scoped CSS shows the scrollbar on hover or focus.
  The script preserves composer focus and restores its attributes on disposal.
  The shared stock surface also covers ordinary split threads. Single-pane views remain unchanged.
- Ask: Give stock conversation viewports a named keyboard focus target and visible focus, preserve that target through pane pointer handling, and expose the scrollbar on hover or focus.
- Status: open
- Category: app-bug
- Evidence: Live split click focused the pane wrapper; PageDown and both arrows left `scrollTop` unchanged at 1000.
  Adding `tabindex="0"` made the viewport retain click focus. PageUp/PageDown moved 616 pixels; arrows moved 40 pixels.
  Installed `SplitWorkspaceRoute`, `page-shell` and `bottom-anchored-scroll-body` frontend bundles confirm the wrapper and viewport contracts.
  Core CSS makes the scrollbar transparent until `data-scrollbar-scrolling="true"`; selection dragging can reveal it through native scrolling.

### Commands and message actions get no SDK client or toast

- Found: 2026-10-22, fork, SDK 0.6.37
- Wanted: a shortcut and a message button that fork the thread and report failures.
- Gap: `PluginCommandContext` and `PluginMessageActionContext` carry no `sdk`, unlike
  `PluginThreadActionItemInput`. `useSdk()` is a hook, so `run` cannot call it. Errors
  from `run` are only logged, and the SDK has no toast API.
- Workaround: an `experimental_appOverlay` lends its `useSdk()` client to the callbacks
  and renders its own progress and error notice: [app.tsx](../fork/app.tsx).
- Ask: `sdk` on both contexts, and a host toast for `run` failures.
- Status: open
- Category: sdk-gap
- Evidence: [fork.ts](../fork/fork.ts)

### File previews have no panel navigation history

- Found: 2026-10-21, file-history, BB desktop 0.46.1, SDK 0.6.49
- Wanted: Return from a linked Markdown file to its parent without leaving the thread.
- Gap: File links select native panel tabs without adding browser history entries.
  Browser Back therefore leaves the thread. The file header has no history controls.
  `experimental_useAppPanel` selects plugin-owned fixed tabs only; it exposes no native file history or header accessory.
- Workaround: [File History](../file-history/README.md) records visited native tab buttons and adds header controls through a content script.
  It intercepts standard mouse Back/Forward events within the visible file panel and preserves app navigation elsewhere.
- Ask: Add native panel Back/Forward controls and route mouse navigation over file previews through the same history controller.
- Status: open
- Category: app-bug
- Evidence: `usePanelFiles.ts`, `useThreadFileTabs.ts`, `app-route-history.ts`; live Chromium reproduction preserved the URL and history length on file-link clicks.

### Plugin workflow activity is absent from sidebar counts

- Found: 2026-10-21, built-in Workflows plugin
- Wanted: Show outstanding workflow activity when its origin agent is idle, across providers.
- Gap: Core counts native background-task events. Workflows stores runs in plugin-owned SQLite, outside that counting path.
- Workaround: A manually applied local bundle patch registers a source of queued/running run IDs and invalidates sidebar activity.
  Scripts and diffs remain in local thread storage. They are not committed or automatically reapplied after BB updates.
  Historical live testing observed the icon appear and disappear during normal execution. Cancellation and active reload remain unverified live.
- Ask: Add a core-owned cached activity summary fed by plugin snapshots, with activation fencing, explicit uncertainty and refresh repair.
  Preserve native counters. Keep execution, cancellation and recovery inside the workflow engine.
  A successful stop request must not establish settlement because core can suppress interrupt errors.
- Status: open. Four design alternatives and two anonymous evaluations informed an unimplemented recommendation.
- Category: sdk-gap
- Evidence: Core `listActiveBackgroundTaskCountsByThreadIds` and `buildThreadActivityStateByThreadId`; Workflows `workflow_runs` queries.

### Helper AI completion consumer

- Found: 2026-10-21, git-glance, SDK 0.6.37
- Wanted: Generate an editable commit message from staged changes on demand.
- Gap: `experimental_aiServices.register` supplies helpers to BB. The public SDK exposes no helper completion consumer.
- Workaround: Git Glance runs installed `codex exec` in an isolated temporary directory with bounded staged input.
  See [message drafts](../git-glance/src/message-draft.ts).
- Ask: Expose a cancellable completion consumer with explicit model and input limits.
- Status: open
- Category: sdk-gap
- Evidence: SDK `PluginAiServices`; [draft generation](../git-glance/src/message-draft.ts).

### Required provider env that fails closed

- Found: 2026-10-11, claude-profiles, SDK 0.6.15 (rechecked 0.6.37)
- Wanted: a Claude turn never starts on the wrong account. If the account cannot
  be resolved, Send is refused and the draft is kept.
- Gap: `bb.providers.experimental_contributeEnv` skips a resolver that throws, times
  out (5 s), returns invalid entries or is not loaded (`plugin-service.ts:2340`,
  `if (!outcome.ok) continue;`). The turn then starts on the default `~/.claude`
  login. `experimental_contributeEnvHealth` (0.6.37) reports status only and does not
  block a launch. The `message.dispatch` hook does not run on resume after a daemon restart.
- Workaround: a guard reads `provider.env-resolved`, stops the turn and refuses the
  next Send: [guard.ts](../claude-profiles/src/accounts/guard.ts),
  [server.ts](../claude-profiles/server.ts). Events arrive at most once a second, so
  the first request can leak.
- Ask: `experimental_contributeRequiredEnv(providerId, resolve)` or a `required: true`
  flag. BB refuses the launch with a safe 409 shown beside the draft.
- Status: open. Core-patch experiment discarded; not deployed.
- For optional Claude account connectors, a BB global machine environment value
  of `ENABLE_CLAUDEAI_MCP_SERVERS=false` supplies the safe default. Agent Switcher
  contributes the combined global, account and thread policy. A failed contribution leaves the default
  intact. This does not enforce required account credentials or protect a live
  process that already started with connectors enabled. Machine environment
  values are masked in launch events, so a fallback cannot prove the off value.
  Agent Switcher retains unknown status and restarts before another send.
- Category: sdk-gap
- Evidence: @thread:thr_a2edzfz5r9, @thread:thr_7m6n8hipb3, commits `083f4c24`, `a42c610`

### Native Send cannot carry plugin submission data

- Found: 2026-10-10, claude-profiles, SDK 0.6.15 (rechecked 0.6.37)
- Wanted: pick a Claude account per draft in the composer, like the model picker,
  and have native Enter and Send honour it.
- Gap: `message.dispatch` gets `experimental_submission` only from a plugin's own
  `useComposer().submit({ experimental_data })`. Native Enter passes `null`
  (`NewThreadComposer.tsx:1730`). Send-now skips dispatch hooks (`dispatch-attempt.ts:527`).
  Queue re-evaluation drops the data (`queued-messages.ts:720`). New-thread composers
  are keyed by project only, so two drafts share state.
- Workaround: the plugin stores the composer choice and claims it in a dispatch hook on
  first send: [routing.ts](../claude-profiles/src/accounts/routing.ts). Children and
  forks inherit the parent's account. A custom Send button was rejected because it
  creates two submission paths. Agent- and CLI-spawned threads take the last click.
- Ask: `useComposer().experimental_setSubmissionData(json | null)`, carried by native
  Send, Send-now, handover and queued re-dispatch.
- Status: open. Core-patch experiment discarded; not deployed.
- Category: sdk-gap
- Evidence: @thread:thr_473r5is977, @thread:thr_kf4v4zdv28, commits `0648e5ed`, `b4378651`

### Additive decoration on a sidebar thread row

- Found: 2026-10-18, claude-profiles, SDK 0.6.37
- Wanted: a small account initial on the Claude icon of each sidebar thread row.
- Gap: no slot adds content to a bundled thread row. `experimental_setThreadRowStatus`
  replaces the draft glyph, takes only an icon name, and competes with the drafts and
  workflows plugins. `experimental_threadList` replaces the whole list and is exclusive.
- Workaround: a content script decorates `a[data-sidebar-thread-id]` rows and their
  `[data-sidebar-thread-provider]` icon by DOM selector:
  [rows.ts](../claude-profiles/ui/badges/rows.ts). A markup change in the bundled
  thread list breaks it without an error.
- Ask: a non-exclusive row accessory slot, for example
  `app.slots.threadRowAccessory({ id, component })` with `{ thread }` props, placed on
  the provider icon or before the title.
- Status: open
- Category: sdk-gap
- Evidence: `claude-profiles/ui/badges/rows.ts`

### `openThreadPanel` always declines in an app overlay

- Found: 2026-10-23, fork, bb 0.46.1, SDK 0.6.37
- Wanted: open a fork in the focused thread's side panel after a keyboard command.
- Gap: `useBbNavigate().openThreadPanel` reads an opener from a React context that only
  the thread detail view provides. An `experimental_appOverlay` sits outside it, so the
  call returns false. Fakes in `renderSlot` accept it, so unit tests pass.
- Workaround: take `openPanel` from the command, message action or thread menu context.
  These use the host's focused-thread opener: [app.tsx](../fork/app.tsx).
- Ask: back `useBbNavigate().openThreadPanel` with the same focused-thread opener
  everywhere, or document the overlay limit on the hook.
- Status: open
- Category: sdk-gap
- Evidence: isolated bb 0.46.1 server and browser repro, commit `9cca0d22`

### Workflow worker row accessories

- Found: 2026-10-21, claude-profiles, SDK 0.6.37
- Wanted: the worker's Claude account beside its workflow model details.
- Gap: workflow worker rows expose neither an accessory slot nor a worker thread
  ID. The preview section exposes its run directive through `title`. The right
  panel displays only the last eight run-ID characters.
- Workaround: [workflows.ts](../claude-profiles/ui/badges/workflows.ts) reads
  `workflowRunView` through the SDK, joins child thread IDs to account bindings,
  and decorates uniquely labelled rows in previews and the right panel.
  [panel-runs.ts](../claude-profiles/ui/badges/panel-runs.ts) resolves panel IDs
  from active runs or recorded assistant directives through paged timeline reads.
  Visible-page runs refresh every five seconds. Duplicate labels are omitted.
- Ask: a workflow worker accessory slot with `{ runId, childThreadId }`, or stable
  DOM attributes for both IDs.
- Status: open
- Category: sdk-gap
- Evidence: `claude-profiles/ui/badges/workflows.ts`, @thread:thr_m6h4c8ja5e

### Workflow running calls have no live timing

- Found: 2026-10-23, workflow-timers, SDK 0.6.37
- Wanted: See how long a running workflow agent has run, and whether it has stalled.
- Gap: Running call rows render no duration. The run header elapsed text renders once and changes only on refresh.
  `workflowRunView` calls expose `startedAt` but no activity time. `workflow_calls.last_activity_at` is written only at start, retry, result and finish.
- Workaround: [timers.ts](../workflow-timers/timers.ts) appends a ticking timer to running preview rows.
  [bridge.tsx](../workflow-timers/bridge.tsx) reads the latest worker thread event through `sdk.threads.events.list` for a quiet label.
  Rows join to calls by unique label, as in the worker row accessories entry.
- Ask: Render a live elapsed timer on running call rows and the run header. Add a `lastActivityAt` per call, updated from child thread events.
- Status: open
- Category: sdk-gap
- Evidence: Workflows `app.js` call row renders duration only when `startedAt` and `finishedAt` are set; `server.js` `last_activity_at` writes.

### Content scripts cannot call plugin RPC or realtime

- Found: 2026-10-18, claude-profiles, SDK 0.6.37
- Wanted: a content script that reads the plugin's own server data and follows its
  realtime events.
- Gap: `useRpc` and `useRealtime` are React hooks only. `PluginContentScriptContext`
  exposes `pluginId`, `generation`, `signal` and `experimental_setThreadRowStatus`,
  with no RPC client.
- Workaround: an always-mounted `experimental_appOverlay` renders `null`, calls the RPC
  and writes a module store that the content script reads:
  [bridge.tsx](../claude-profiles/ui/badges/bridge.tsx).
- Ask: `context.rpc` and `context.realtime.subscribe` on `PluginContentScriptContext`.
- Status: open
- Category: sdk-gap
- Evidence: `claude-profiles/ui/badges/bridge.tsx`

### Persistent message metadata

- Found: 2026-10-19, chat-timestamps, SDK 0.6.37
- Wanted: visible chronology markers between message groups without opening action menus.
- Gap: `messageAction` renders host-owned buttons, not persistent custom metadata.
  Content scripts have DOM access but cannot call `useSdk`.
- Workaround: a null overlay reads deferred timeline metadata through `useSdk`.
  A module store joins recorded `startedAt` values to `data-timeline-row-id`.
  A content script adds gap markers and requests missing times when rows appear.
  Row selectors and thread-prefixed IDs depend on BB's markup.
- Ask: an additive message-boundary slot with a stable message reference and recorded timestamp.
- Status: open
- Category: sdk-gap
- Evidence: [bridge.tsx](../chat-timestamps/bridge.tsx), [labels.ts](../chat-timestamps/labels.ts)

### Terminal options hook

- Found: 2026-10-11, terminal-tweaks, SDK 0.6.15 (rechecked 0.6.37)
- Wanted: Option as Meta, Kitty keyboard protocol (Shift+Enter in TUIs), OSC 52
  writes, copy on select, steady cursor and font size in BB terminals.
- Gap: BB creates xterm.js with fixed options (`fontSize: 12`, `cursorBlink: true` in
  `ThreadTerminalView`). No setting or SDK hook exists, and plugins cannot reach the
  `Terminal` instance. `vtExtensions.kittyKeyboard` is off. Content scripts get no
  settings, so an option toggle cannot be built.
- Workaround: a content script walks up to 40 React fibers from `.xterm` to the
  Terminal ref and sets options at runtime: [app.ts](../terminal-tweaks/app.ts),
  [xterm.ts](../terminal-tweaks/xterm.ts). A BB refactor breaks it without an error.
- Ask: user settings for these options, or `app.terminals.experimental_configure(options)`
  or an `onTerminalCreated(term)` hook.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_8r5tzd7tya, @thread:thr_benwdpqxs8, @thread:thr_iang4iumus, commit `b2958d94`

### Command API is register-only

- Found: 2026-10-11, shortcut-guide, handsfree, SDK 0.6.15 (rechecked 0.6.37)
- Wanted: usage-ranked shortcut help that flags missed shortcuts, and voice commands
  that run BB's own commands such as new thread or `question.select.N`.
- Gap: `PluginAppCommands` has only `register()`. It cannot list, run or observe core
  commands. Palette recents keep 8 IDs in `localStorage`, with no counts or source.
  Native number shortcuts are ignored while an editable field has focus, so a fake key
  press cannot confirm a choice.
- Workaround: a hand-kept `catalogue.ts` and Essentials list; usage ranking is dropped:
  [shortcut-guide/README.md](../shortcut-guide/README.md). Handsfree clicks DOM buttons:
  [choice-target.ts](../handsfree/choice-target.ts).
- Ask: `app.commands.experimental_list()`, `experimental_dispatch(commandId, args?)` and
  `experimental_onInvoked(({ commandId, source }) => ...)`.
- Planned trial: add invocation events in an isolated source build using the
  local BB patch notes in `spikes/bb-patched/README.md` (ignored research). Verify one event per handled
  native shortcut, plugin command and palette action; rejected commands emit none.
  Use a temporary event viewer before adding local counts to Shortcut Guide.
  Button coverage follows separately. Keep the daily server unchanged during the trial.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_6arvxhyzt4, @thread:thr_autjzsat5n, commit `879585d8`, `spikes/tmux/TRIAGE.md:158`

### Thin command context and overlay limits

- Found: 2026-10-11, run-in-terminal, lazygit, git-glance, SDK 0.6.15 (rechecked 0.6.37)
- Wanted: commands and shortcuts that act on the composer's project and open a terminal
  from anywhere, including the New thread screen.
- Gap: `PluginCommandContext` is `{ threadId, projectId, openPanel }`, with no rpc,
  navigation or `openTerminal`. `projectId` comes from the route, so it is null at `/`.
  `navigate.experimental_openTerminal` returns false outside a thread view or composer
  subtree. In an overlay, `useComposer()` returns an unmounted draft with `projectId: null`.
- Workaround: invisible per-thread header openers
  ([run-in-terminal/app.tsx](../run-in-terminal/app.tsx)), and always-mounted overlays
  with module stores. The lazygit command fails on the New thread screen.
- Ask: `navigate` and `openTerminal` on `PluginCommandContext`, and `projectId` from the
  focused composer.
- Status: open. `openPanel` in 0.6.37 may cover part of it.
- Category: sdk-gap
- Evidence: @thread:thr_vprg2gtvp7, @thread:thr_fypszmqyd4, commits `42c0622b`, `7f1f5c8f`

### Bind a thread to an existing provider session

- Found: 2026-10-15, claude-profiles, SDK 0.6.37
- Wanted: carry live tmux Claude Code sessions into BB threads with their history.
- Gap: `createThreadRequestSchema` has no provider session field, and no route appends
  timeline events. The first thread to record a session ID claims it; others get 409.
  The timeline renders only from the `events` table.
- Workaround: `bb claude-profiles import` spawns a stub thread, switches its profile,
  then copies the transcript over the stub's session with IDs rewritten:
  [server.ts](../claude-profiles/server.ts). History reaches Claude's context but not
  the BB timeline.
- Ask: `threads.create({ provider, providerSessionId })` or
  `bb thread import --session <id>` that backfills timeline events.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_vektgz87sg, @thread:thr_6dq5m7peea, commit `439f9fb5`

### Per-request Claude usage and 5m/1h cache-write split

- Found: 2026-10-10, cache-hits, SDK 0.6.15 (rechecked 0.6.37)
- Wanted: a thread chip with cache hit rate, misses per request and a cache-expiry countdown.
- Gap: `thread/tokenUsage/updated` comes only from the end-of-turn result
  (`delta-translation.ts:1076`). `threadEventTokenUsageBreakdownSchema` has one
  `cacheWriteInputTokens`, with no 5m/1h split. Raw SDK messages reach plugins only as
  `provider/unhandled`. Pi reports only the last request per turn. Old usage events are pruned.
- Workaround: the host reads Claude's internal `~/.claude*/projects/<cwd>/<session>.jsonl`
  and re-checks on `thread.idle`. This needs `CLAUDE_CONFIG_DIR` discovery.
- Ask: per-request usage events with `cacheWrite5m` and `cacheWrite1h`.
- Status: requested <https://github.com/get-bb/bb/issues/5349>
- Category: sdk-gap
- Evidence: @thread:thr_x4yp4umsyb, @thread:thr_x523wkg7m3, @thread:thr_xkyabrrv7w, commit `405b72a8`

### App-global header slot, chip order and overflow

- Found: 2026-10-11, machine-health, vox-recorder, chip, SDK 0.6.15 (rechecked 0.6.37)
- Wanted: one always-visible app-wide indicator, and a tidy header in narrow panes.
- Gap: `experimental_threadHeaderAction` mounts once per split pane, so chips repeat.
  `experimental_appOverlay` has no visible placement and cannot open file previews.
  The host sorts chips by plugin id, with no `order`. Slots get only
  `isCompactViewport`, not pane width. Below about 1000 px the title and close buttons
  are pushed off-screen.
- Workaround: the shared chip package with an `@container` collapse rule
  ([ADR 0002](./adr/0002-shared-header-chip-package.md)). Popovers find the visible
  chip by DOM selector. Vox shows a pill in every pane.
- Ask: an app-level status or toolbar slot, `order` on registrations, and host overflow
  into a "more" menu.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_hntrpwmmhs, @thread:thr_iang4iumus, commit `cfef2b01`, `spikes/tmux/TRIAGE.md:121`

### Shortcut model: silent collisions, one combination, no chords

- Found: 2026-10-11, several plugins, SDK 0.6.15 (rechecked 0.6.37)
- Wanted: a warning when defaults collide, correct hints after a rebind, and
  tmux-style prefix chords.
- Gap: a colliding plugin default stays unbound without notice. The Alt+T default lost
  to BB's reasoning cycle this way. `PluginCommandShortcut` holds one combination. No API
  reads the effective binding, and `bb settings keyboard list --json` omits plugin
  commands. `PluginAppSetup` is synchronous, so commands are static.
- Workaround: a vitest fails on duplicate `defaultShortcut` values across plugins.
  Hints are hardcoded. A menu imitates a prefix table.
- Ask: a conflict warning in Settings and the plugin log, an effective-binding getter,
  plugin commands in `keyboard list`, and chords.
- Status: open. The types show a `when` object (`bb-plugin-sdk-app.d.ts:10667`), so it may be partly fixed.
- Category: sdk-gap
- Evidence: @thread:thr_6d9wg6i4hu, @thread:thr_iang4iumus, `spikes/tmux/TRIAGE.md:119`

### Composer and question-box keys are hardcoded

- Found: 2026-10-11, composer-keys, SDK 0.6.37
- Wanted: rebind Enter, Alt+Enter, Cmd+Enter and Escape in the composer and question
  box. Escape stops a run; Esc Esc opens rewind.
- Gap: BB hardcodes these handlers. `updateKeyboardSettings` does not cover them, and no
  composer key hook exists. `sdk.threads.stop` does not match the Stop button.
  `useBbContext().threadId` is window-global, so a split pane can target the wrong
  thread. `conversationOutline` items have no `seq` for `editMessage`.
- Workaround: a capture-phase `keydown` listener re-dispatches keys and matches
  `[data-promptbox]`, the `Stop run` label and the question placeholder:
  [app.tsx](../composer-keys/app.tsx).
- Ask: rebindable keybinding IDs for composer submit, newline and escape, `seq` on
  outline items, and a pane-scoped thread id.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_pidqvgu5ze, @thread:thr_iang4iumus, commit `8a31ef6b`

### Answer pending questions from outside their card

- Found: 2026-10-12, handsfree, SDK 0.6.37
- Wanted: voice commands that pick a question choice.
- Gap: `experimental_useQuestionFormHost` works only inside a `pendingInteraction`
  component. `bb thread` has no interactions command. Approvals already work through
  `threads.interactions.list/resolve`.
- Workaround: [choice-target.ts](../handsfree/choice-target.ts) finds the focused pane by
  `[data-split-pane-id][data-focused]` and clicks `button[aria-pressed]` in the question
  `fieldset`.
- Ask: `threads.interactions.answer(threadId, interactionId, choice)` and a
  `bb thread interactions` command.
- Status: open. 0.6.37 adds `ExperimentalQuestionFormHost.registerChoiceHandler`; check
  whether it removes the DOM path.
- Category: sdk-gap
- Evidence: @thread:thr_48pkehyxey, @thread:thr_autjzsat5n, commit `fd0dcd40`

### Toast and OS notification API

- Found: 2026-10-11, vox-recorder, machine-health, skill-loader, SDK 0.6.15 (rechecked 0.6.37)
- Wanted: transient notices and OS banners from plugins, for example when a recording
  finishes or memory runs low.
- Gap: the types expose no toast or notify call. "toast" appears only in comments.
  The host toast renders under `showModal` dialogs.
- Workaround: vox draws its own notice stack; a modal makes it inert
  ([vox-recorder/README.md](../vox-recorder/README.md)). machine-health keeps a launchd
  daemon for banners. skill-loader closes with no feedback.
- Ask: `app.experimental_toast({ text, tone })` above top-layer dialogs, and
  `app.experimental_notify({ title, body, threadId })` for OS notifications.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_6d9wg6i4hu, commits `f6eeca36`, `cb71b0d3`, `spikes/tmux/TRIAGE.md:126`

### Terminal API: polled output, no env or placement on create

- Found: 2026-10-11, ghostty-terminal, output-hints, terminal-launchers, SDK 0.6.37
- Wanted: a Ghostty tab, an on-screen hints picker and tmux-style popup launchers.
- Gap: `terminals.output` returns raw PTY chunks (`sinceSeq`, `tailBytes`), with no
  subscription, rendered grid or live cwd. `createTerminalRequestSchema` is strict, with
  no `env`, thread cwd, placement, close-on-exit or metadata. `openTerminal` returns
  false for a command that exits at once.
- Workaround: ghostty-terminal uses BB's internal terminal WebSocket. Output-hints
  parses OSC 7 for the cwd. Launchers use `zsh -ic` and match on title.
- Ask: `terminals.subscribe`, `terminals.screen`, and `env`, `cwd` and `metadata` on create.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_8r5tzd7tya, `spikes/tmux/output-hints`, `spikes/tmux/terminal-launchers`

### Code fence action slot

- Found: 2026-10-14, run-in-terminal, SDK 0.6.37
- Wanted: a run button beside each shell fence's copy button that pastes into a terminal.
- Gap: BB draws code fences itself with no slot. `experimental_sourceCodeRenderer`
  replaces the whole renderer and covers file previews only. Directives inside fences
  stay literal.
- Workaround: a thread action and a message action collect shell fences, or the
  selection, and bracket-paste into one terminal:
  [run-in-terminal/README.md](../run-in-terminal/README.md).
- Ask: `app.slots.codeBlockAction({ id, languages, component })` with
  `{ language, code, threadId }` props.
- Status: open. A request was drafted but not filed.
- Category: sdk-gap
- Evidence: @thread:thr_fypszmqyd4, commit `7f1f5c8f`

### Link accessories and inline commit hashes in chat Markdown

- Found: 2026-10-14, external-links, SDK 0.6.37
- Wanted: an arrow beside chat web links that opens the system browser, while plain
  clicks keep the BB browser preference. Git Glance also opens inline commit hashes.
- Gap: no slot or render hook decorates timeline Markdown anchors or inline code.
- Workaround: a content script and MutationObserver decorate
  `[data-markdown-preview] a`: [links.ts](../external-links/links.ts). BB markup
  changes can break it. Git Glance decorates hash-shaped inline code through
  [chat-links.ts](../git-glance/chat-links.ts), preserving text nodes and restoring attributes on disposal.
- Ask: a non-exclusive Markdown decorator for links and inline code, with message thread context.
- Status: open. `experimental_timelineRenderer` excludes core assistant messages.
- Category: sdk-gap
- Evidence: commit `885896da`, `external-links/README.md:15`

### Sidebar: hide Pinned, project heading menu

- Found: 2026-10-14, focus, SDK 0.6.37
- Wanted: a focus or privacy view that shows only selected projects.
- Gap: thread-list filtering cannot hide the Pinned group. No context-menu hook exists
  on a project heading. Renaming or redacting rows needs the exclusive
  `experimental_threadList`. Same root cause as the row decoration entry.
- Workaround: non-focused projects move into "More" through `hiddenGroups`. Pinned
  threads stay visible: [focus/README.md](../focus/README.md).
- Footer gap: disclosures expose no right-click callback or persistent active state.
  Focus captures click and context-menu events on its footer button, retains the SDK
  disclosure for project selection, and decorates the active state through a content script.
- Ask: a group filter that includes Pinned, a `projectHeaderMenu` slot, and `active` and
  `onContextMenu` on footer items.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_cn53dfhu4k, commit `0e99be89`

### Window presence and scoped realtime

- Found: 2026-10-11, git-glance, claude-profiles, SDK 0.6.15 (rechecked 0.6.37)
- Wanted: watch repos only while a window shows them, and mark cache data cold on an
  account switch.
- Gap: no thread-opened, visible or window-closed event. `bb.realtime.publish` reaches
  every client of the plugin, with no channel filter, and never other plugins. No
  account-switch event. Cross-plugin `callRpc` has no output typing.
- Workaround: each window renews a 30 s lease per thread; leases expire after 75 s.
  A `cache-hits.invalidate` RPC.
- Ask: client presence events or a host `onClientDetached`, scoped realtime channels,
  and typed cross-plugin RPC.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_8mt4jyww4v

### MCP servers once for every provider, scoped per thread

- Found: 2026-10-17, executor, SDK 0.6.37
- Wanted: add an MCP server once, and every agent and Claude account in a chosen project
  or thread gets it.
- Gap: BB has no MCP setting and builds the Claude command line itself.
  `bb.agents.registerTool` tools are fixed at load. `configure()` gets no project or
  thread context and applies only at the next session. The first plugin to register a
  tool name wins. `PluginAgentToolContext` has only `signal`.
- Workaround: the executor plugin registers MCP tools and reloads itself when the list
  is known. Separate entries per scope, each toggled globally.
- Ask: a provider-agnostic MCP setting, or project and thread context on
  `agents.configure()`, plus dynamic tool registration.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_gphz9jr2wb, commit `615faf0f`

### Usage contract is private and drops failure detail

- Found: 2026-10-12, agent-usage, claude-profiles, SDK 0.6.15 (rechecked 0.6.37)
- Wanted: accurate "updated" times, and a banner that names the failing account.
- Gap: native usage comes only from the private `getUsage` RPC. Windows have no
  `measuredAt`, so data can be 2 min older than shown. Statuses are undocumented.
  "Some usage could not be refreshed" names no account. `windowSchema` has no window
  length. The built-in reader ignores `CLAUDE_CONFIG_DIR`.
- Workaround: a hand-copied schema in
  [overview.ts](../claude-profiles/src/accounts/usage/overview.ts). The plugin shows its
  own fetch time.
- Ask: export the usage contract with `measuredAt`, failure `accountId` and reason, and
  window length.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_zqaqu3f5qy, @thread:thr_mwk4t6gthq, commits `d140e19a`, `b925430c`

### Thread-to-process mapping

- Found: 2026-10-11, machine-health, SDK 0.6.15 (rechecked 0.6.37)
- Wanted: attribute memory to threads and offer Hibernate.
- Gap: `ThreadResponse` has no pid or "runtime loaded" field. `listRunning` returns
  `{ id, hostId }`. Codex threads share one `codex app-server`, which BB ends only when it
  holds no threads.
- Workaround: match `BB_THREAD_ID` in the process env plus a bridge-worker heuristic.
  Codex threads are not listed: [machine-health/README.md](../machine-health/README.md).
- Ask: `runtime: { pid, loaded, shared }` on running threads, and per-thread hibernate.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_6d9wg6i4hu, `spikes/tmux/mem-pressure/SPIKE.md:68`

### Fork and spawn schemas are too narrow

- Found: 2026-10-11, fork-fanout, critique-review, claude-profiles, SDK 0.6.37
- Wanted: fan-out forks on other models, read-only review threads, and child threads on
  a chosen account.
- Gap: fork cannot change provider or model, name a branch or cross machines.
  `permissionMode` has no read-only value. The handoff request has no `sourceThreadId`.
  Spawn takes no plugin data, so a child cannot pick an account. Children of a thread on
  an exhausted account all fail.
- Workaround: none for fan-out. For accounts, stop each child, switch it, then retry.
- Ask: provider, model, branch and plugin data on fork and spawn, a read-only permission
  mode, and `sourceThreadId` on handoff.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_dys4fhvc4c, @thread:thr_zw9uifps9c, `spikes/tmux/fork-fanout`

### Events API limits

- Found: 2026-10-10, cache-hits, composer-keys, attention, SDK 0.6.37
- Wanted: full per-thread usage history and queries across threads.
- Gap: `threads.events.list` rejects `limit > 100` with HTTP 400, though the type is
  `limit?: string`. `threadId` is required, and there is no item-kind filter. Old usage
  events are pruned. Timeline rows clip output to about 4.2K characters.
  `includeClearedContextHistory` is internal.
- Workaround: page with `afterSeq` and keep plugin-side state. Attention caps at 40
  threads and 300 rows.
- Ask: document the cap, and add a cross-thread `events.list` with a `kinds` filter and a
  full-output fetch.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_x523wkg7m3, `composer-keys/app.tsx`

### Mention providers lack context and time

- Found: 2026-10-12, skill-loader, SDK 0.6.37
- Wanted: install a skill into the thread's repo from an `@` mention.
- Gap: mention `resolve` gets no thread or host context (`plugin-mentions.ts`). Search is
  capped at 2 s and resolve at 10 s per pill. Pills resolve in series. A bare `@` never
  reaches providers.
- Workaround: the host id goes inside the item id, a warm catalogue preloads, and
  resolve uses 9 s. A composer with no thread cannot install:
  [skill-loader/README.md](../skill-loader/README.md).
- Ask: pass `{ threadId, hostId }` to `resolve`, and resolve pills in parallel.
- Status: open
- Category: sdk-gap
- Evidence: `spikes/tmux/skill-loader`, `spikes/tmux/TRIAGE.md:124`

### File-backed declarative preferences

- Found: 2026-10-10, preferences, SDK 0.6.15
- Wanted: shortcuts and plugin states in a tracked file that wins over UI edits.
- Gap: BB stores settings only through the UI and API. The settings API returns
  command, shortcut and platform in a different order from what was written, and emits
  no change event with origin.
- Workaround: a reconciler watches a JSON file and applies it with order-independent
  comparison: [preferences/server.ts](../preferences/server.ts). An early version
  looped. Plugin states use a one-shot `bb-plugins check/apply` script.
- Ask: a file-managed settings layer that BB watches, or a stable-order API and a
  settings-changed event with origin.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_66wtwrm964, @thread:thr_9sjwthgthc, commits `913d836a`, `e1c2e977`

### Host UI primitives

- Found: 2026-10-11, chip, vox-recorder, lazygit, executor, SDK 0.6.37
- Wanted: consistent chips, anchored popovers and dialogs across plugins.
- Gap: the SDK exports no chip, Button, Dialog, Input, Popover or anchor-positioning
  helper. Plugin CSS is global, so the copy that loads last wins.
- Workaround: the shared `ChipPopover`
  ([ADR 0003](./adr/0003-shared-chip-popover.md)). The executor plugin vendors UI from
  the scaffold.
- Ask: export host UI primitives.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_hntrpwmmhs, @thread:thr_iang4iumus

### Host-ready signal for plugins

- Found: 2026-10-14, caffeine, SDK 0.6.37
- Wanted: the caffeine plugin works after a BB restart.
- Gap: plugins load about 262 ms before the host daemon connects.
  `system.config().primaryHostPlatform` is null in that gap, with no ready signal.
- Workaround: cache only a confirmed Mac host, and re-read on `host:changed`:
  [caffeine/server.ts](../caffeine/server.ts).
- Ask: a `hosts.ready()` promise, or config only after the primary host is known.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_bkek4we5h9, @thread:thr_i86tgtp4dd, commit `94dc73f0`

### Provider bridge development

- Found: 2026-10-16, remote-proxy spike, SDK 0.6.37
- Wanted: a remote-proxy provider for Claude cloud sessions.
- Gap: the bundled bridge cannot ship extra files. After `bb plugin reload`, an existing
  thread keeps the old bridge until `bb thread stop`. Bridge state is lost on restart.
  Follow-ups arrive with a `[bb message from thread:...]` prefix.
- Workaround: per-thread state in the data directory and a manual `bb thread stop`.
- Ask: bridge asset bundling and hot swap on reload.
- Status: open
- Category: sdk-gap
- Evidence: @thread:thr_gjb5jjbvwv, `spikes/remote-proxy`

## Open: app and provider bugs

### Worktree teardown deletes uncommitted work

- Found: 2026-10-11, worktree-reaper spike, BB 0.46.0
- Wanted: archiving or removing a worktree environment never loses uncommitted work.
- Gap: teardown runs `git worktree remove --force`, then `fs.rm` with
  `{ recursive: true, force: true }` (`environment-git-worktree/host/worktree.ts:655-678`).
  A dirty check exists only for abandoned provisioning. Auto-retire after archive uses
  the same path. A UI confirm was not checked.
- Workaround: worktree-reaper guards only its own removals.
- Ask: refuse or confirm teardown when the worktree is dirty or unpushed, or add a
  pre-teardown plugin hook.
- Status: open
- Category: app-bug
- Evidence: `spikes/tmux/worktree-reaper/SPIKE.md` (ignored research), `spikes/tmux/TRIAGE.md`

### Claude fork and side chat ignore the account config dir

- Found: 2026-10-02, claude-profiles, BB 0.46.0
- Wanted: fork or side chat on a thread that runs on a non-default Claude account.
- Gap: the bridge `handleThreadFork` calls `forkSession(id, { upToMessageId })` in the
  bridge worker, with no `dir`, `sessionStore` or env. The worker has no
  `CLAUDE_CONFIG_DIR`, so the SDK scans only `~/.claude/projects`. The result is
  `Session <id> not found`, or a fork of a stale Default copy. `ForkSessionOptions`
  has no per-call env. A mid-thread switch can give "No conversation found".
  Reconfirmed on BB 0.46.1 (SDK 0.3.245): live forks of Default threads work and
  forks of two account threads fail. Changing only `CLAUDE_CONFIG_DIR` toggles the
  SDK fork from fail to pass and back.
- Hook order: `message.dispatch` runs for a fork's first dispatch at fork creation,
  before provisioning and before the bridge forks. `claimBinding` therefore binds a
  side chat to its source's account before launch, so a bridge that forked with the
  launch env would need no plugin change.
- Workaround: forks work only on Default
  ([claude-profiles/README.md](../claude-profiles/README.md)). The plugin copies the
  transcript on switch. See `spikes/session-context/README.md` (ignored research).
  For forks on a named account, including side chats, the `message.dispatch` hook links
  the source's account project dir into Default as
  `~/.claude/projects/+bb-fork-stage-<forkThreadId>`
  ([fork-stage.ts](../claude-profiles/src/accounts/fork-stage.ts)). The bridge then finds
  the source and writes the fork into the account. The link goes when the fork has its
  session or fails, with a five-minute sweep as a backstop. Delete it when a stock
  bridge forks with the launch env. Rejected: an account-wide shared
  `projects/` store (cross-account retention sweep, shared memory and listings, lossy
  migration of 10 diverged sessions), a context-seeded side chat (about half the
  session context, a second menu item, 400-600 lines) and Default-only use.
  Spikes: `spikes/side-chat-{staged-fork,shared-store,seeded}/`.
- Ask: run provider session operations (fork, resume, history) with the thread's
  resolved launch env.
- Status: open (patched locally: spikes/bb-patched/patches/04; upstream issue drafted, not filed)
- Category: provider
- Evidence: @thread:thr_zzwj5k863r, @thread:thr_fqyne6kvdz, @thread:thr_vdwff57q6d,
  @thread:thr_rbf6afrp8v, commits `e555e65`, `2c4f4186`

### Queued limit retry blocks account switching

- Found: 2026-10-18, claude-profiles, BB 0.46.0
- Wanted: switch a rate-limited thread to another account and retry now.
- Gap: BB queues a system "Please continue." for the limit reset, hours away. The
  queued message makes the thread non-idle, so the plugin refuses to switch.
  `bb thread retry` returns 409 "already has a retry waiting". The built-in
  `provider-retry` also races a profile auto-switch.
- Workaround: `bb thread stop`, `bb thread queue delete`, switch, then `bb thread retry`.
- Ask: a "retry now" that replaces the waiting retry, and expose the waiting retry so
  plugins can treat it as idle.
- Status: open
- Category: app-bug
- Evidence: @thread:thr_k8h8gbmkid, @thread:thr_dys4fhvc4c, @thread:thr_ah4vmi2dy6

### Terminals and threads do not survive reconnect or quit

- Found: 2026-10-02, tmux migration, BB 0.45
- Wanted: tmux-level durability.
- Gap: any daemon-server reconnect kills all terminals (`expireDisconnectedHostTerminals`).
  Quitting the desktop app stops the server and every thread. The "Replace" attach
  prompt kills a launchd server. A host daemon restart killed a running thread.
- Workaround: a planned launchd server with `BB_DESKTOP_ATTACH_WITHOUT_PROMPT=1`.
- Ask: reattach terminals after reconnect (upstream #4271), and keep threads running on
  desktop quit.
- Status: open
- Category: app-bug
- Evidence: @thread:thr_cvepgdaq8g

### Non-standard git layouts break diff, status and spawn

- Found: 2026-10-11, git-glance, diff-viewer, BB 0.46.0
- Wanted: Changes, git status and thread spawn for the `~` project, which uses a
  separate git dir, and for a non-git project root.
- Gap: core diff returns `non_git_environment`, and status says "not a git repo".
  `openFixedTab` cannot open the core Changes tab. `bb thread spawn --project` returns
  409 "This project checkout has no usable git branch". BB cannot make worktrees there.
- Workaround: diff-viewer runs git with `--git-dir` and `--work-tree` through `bb.host`
  ([diff-viewer/README.md](../diff-viewer/README.md)). Spawn uses `--environment <id>`.
- Ask: per-project `GIT_DIR` and `GIT_WORK_TREE`, or a plugin diff source for the core
  panel. Spawn falls back to the checkout or names the flag to pass.
- Status: open
- Category: app-bug
- Evidence: @thread:thr_k8h8gbmkid, `spikes/tmux/critique-review/SPIKE.md:83`

### Plugin shortcuts do not fire while a terminal has focus

- Found: 2026-10-14, git-glance, vox, caffeine, BB 0.46.0
- Wanted: popover shortcuts such as Alt+K and Alt+G that work anywhere.
- Gap: xterm with `macOptionIsMeta` stops propagation, and BB attaches no
  `customKeyEventHandler` (`usePluginCommandBindings.ts:30-36`).
- Workaround: none: blocked.
- Ask: route registered app shortcuts through an xterm `customKeyEventHandler`.
- Status: open
- Category: app-bug
- Evidence: @thread:thr_vprg2gtvp7, @thread:thr_iang4iumus

### `@` file search hides plugin mention rows in home threads

- Found: 2026-10-11, skill-loader, BB 0.46.0
- Wanted: plugin `@` rows that always show.
- Gap: BB's file search fails with a permission error on `~/.Trash`. The failure hides
  every plugin's `@` rows in threads whose checkout is the home folder.
- Workaround: use Alt+S.
- Ask: skip unreadable directories.
- Status: open
- Category: app-bug
- Evidence: @thread:thr_6d9wg6i4hu, `spikes/tmux/TRIAGE.md:127`

### Native `<dialog>` is not treated as modal

- Found: 2026-10-11, chip, thread-clipboard spike, BB 0.46.0
- Wanted: BB's global shortcuts pause while a plugin modal is open.
- Gap: BB sets `modalOpen` from `aria-modal` or `[role=dialog][data-state=open]`, not
  from `showModal()`. Escape in a plugin dialog also fires `app.back`.
- Workaround: `ChipPopover` sets `aria-modal` and stops other keys:
  [popover.tsx](../chip/popover.tsx).
- Ask: treat an open `:modal` dialog as modal.
- Status: open
- Category: app-bug
- Evidence: commit `7ab3d0dc`, `spikes/tmux/thread-clipboard/SPIKE.md:103`

### Composer focus not restored after a question form

- Found: 2026-10-12, handsfree, BB 0.46.0
- Wanted: after a native question is answered, the caret returns to the composer.
- Gap: `question-form.tsx:387` submits and `UserQuestionInteractionContent.tsx:49`
  resolves. Neither restores focus, and `PluginPendingInteractionComposer.tsx:57` is the
  same. The resolved-interaction cache unmounts the focused form.
- Workaround: the plugin watches the form root until it disconnects, then calls
  `composer.focus()` with guards.
- Ask: restore composer focus when the form unmounts, or an `onInteractionResolved` event.
- Status: open
- Category: app-bug
- Evidence: @thread:thr_autjzsat5n

### Codex threads ignore contributed env

- Found: 2026-10-02, claude-profiles, BB 0.46.0
- Wanted: a per-thread Codex account through `CODEX_HOME`.
- Gap: contributed env reaches only tool shells, not the Codex app-server
  (`session-params.ts:586-606`). `BB_CODEX_BRIDGE_APP_SERVER_COMMAND` is global.
- Workaround: none: blocked.
- Ask: apply contributed env to the provider process.
- Status: open
- Category: provider
- Evidence: @thread:thr_sxsccs2h2f, @thread:thr_kf4v4zdv28

### Empty provider env values pass through

- Found: 2026-10-12, claude-profiles, BB 0.46.0
- Wanted: an empty env value means "unset".
- Gap: `CLAUDE_CONFIG_DIR=""` reached Claude. Claude wrote `sessions/` into the cwd and
  failed with "No conversation found".
- Workaround: the Default account contributes no env.
- Ask: drop or reject empty-string entries in env contributions.
- Status: open
- Category: provider
- Evidence: commit `4b793759`

### No downgrade guard for the data dir

- Found: 2026-10-11, bb-patched spike, BB 0.46.0
- Wanted: run a pinned or patched server beside stock desktop releases.
- Gap: a stock desktop update migrates `~/.bb` forward, with no guard against an older
  server reading it.
- Workaround: rebase patches before each stock update, and quit the desktop first. The
  spike went back to stock in `cd06c1d7`.
- Ask: a schema version check that refuses to start an older server on newer data.
- Status: open
- Category: app-bug
- Evidence: @thread:thr_a2edzfz5r9, `spikes/bb-patched/README.md` (ignored research)

### Plugin uninstall and rename strand stored data

- Found: 2026-10-10, cache-hits, claude-profiles, BB 0.46.0
- Wanted: clean uninstall and safe package renames.
- Gap: uninstall leaves `plugin_kv` rows. Storage is keyed by a plugin id from the
  package name, with no rename or migration.
- Workaround: manual `sqlite3` delete. The package kept its old name; only the display
  name changed.
- Ask: `bb plugin uninstall --purge`, and a storage migration on rename.
- Status: open
- Category: app-bug
- Evidence: @thread:thr_x523wkg7m3

### Mobile compact start screen leaves a top gap

- Found: 2026-10-15, mobile-home-spacing, BB 0.46.0
- Wanted: on mobile, recent threads fill the start screen below the toolbar.
- Gap: `RootComposeCompactHome.tsx:10` reserves space for 4.5 rows from screen height,
  with an inline scroll offset and a leading spacer.
- Workaround: a content script adds 3 CSS rules keyed on `root-compose-compact-*`:
  [mobile-home-spacing/README.md](../mobile-home-spacing/README.md).
- Ask: fix the compact layout upstream.
- Status: open
- Category: app-bug
- Evidence: @thread:thr_yyuas7zkky, commit `a99bce6f`

### Embedded browser has one shared profile

- Found: 2026-10-15, research only, SDK 0.6.37
- Wanted: open existing Chrome profiles in a side tab without re-importing.
- Gap: all embedded tabs share one `persist:bb-browser` partition
  (`desktop-browser-broker.ts:388`), so cookie imports from several profiles mix.
  Browser automation uses a temporary headless profile. The types have no profile option.
- Workaround: none. A live-mirror prototype was too unreliable.
- Ask: named embedded browser profiles per tab, or Chrome attach with profile choice.
- Status: open
- Category: other
- Evidence: @thread:thr_6qbbmst7xp, @thread:thr_u9iw9s2rpp

### Login-shell env import takes only PATH

- Found: 2026-10-16, no plugin, BB 0.45.0
- Wanted: variables exported in the login shell reach agent processes.
- Gap: `host-daemon/src/runtime-shell-env.ts:304` starts an interactive login shell but
  keeps only `PATH`.
- Workaround: explicit injection per tool.
- Ask: a documented env allow-list setting.
- Status: open. This may be intended.
- Category: app-bug
- Evidence: @thread:thr_mnd7v923jw

### Generated thread titles read as refusals

- Found: 2026-10-18, no plugin, BB 0.46.0
- Wanted: titles that summarise the prompt.
- Gap: BB cloud titled child threads "I can't inspect the local files, Git history,
  or..." although the agents ran normally.
- Workaround: none.
- Ask: the title model summarises the prompt and never answers it.
- Status: open
- Category: app-bug
- Evidence: @thread:thr_k8h8gbmkid

## Open: CLI and tooling

### Global instruction loading has no XDG configuration path

- Found: 2026-10-21, agent configuration
- Wanted: Keep global BB instructions in the XDG configuration directory, separate from runtime data.
- Gap: The installed loader reads `<dataDir>/AGENTS.md` and workspace `.bb/AGENTS.md`.
  It does not check `$XDG_CONFIG_HOME/bb/AGENTS.md` or its default `~/.config/bb/AGENTS.md`.
- Workaround: Track the native `.bb/AGENTS.md` directly in dotfiles. Keep maintenance procedures in [the BB guide](../../../docs/bb.md).
- Ask: Support an XDG global instruction path with documented precedence when the data-directory file also exists.
- Status: open. This finding concerns instruction loading, not all BB configuration.
- Category: other
- Evidence: Installed core `readDataDirAgentInstructions` and `DATA_DIR_AGENT_INSTRUCTIONS_RELATIVE_PATH`; `bb guide agent-configuration`.

### SDK types lag the runtime

- Found: 2026-10-10, handsfree, tmux spikes, SDK 0.6.15 to 0.6.39
- Wanted: published types and harness that match what BB ships.
- Gap: BB 0.46.0 runs SDK 0.6.37. Code typed against 0.6.15 cast
  `experimental_copyToClipboard`, `experimental_openTerminal` and
  `experimental_threadAction`. `experimental_useSidebarThreadActions` left the 0.6.37 types
  but still runs. Published 0.6.39 lacks the runtime question-choice hook. Duplicate zod
  copies break `callRpc` types. The harness needs undeclared `better-sqlite3` and `cron-parser`.
- Workaround: casts, feature detection, a local SDK build, a pnpm catalog pin for zod and
  declared peers.
- Ask: publish the SDK with each BB release, make zod a peer, declare harness peers, and
  document removals.
- Status: open (maybe partly fixed since 0.6.40)
- Category: cli
- Evidence: @thread:thr_iumjki3tqm, commits `c146447c`, `ac5b2a71`, `4d553f6b`

### Plugin CLI diagnostics

- Found: 2026-10-12, caffeine, workspace, BB 0.46.0
- Wanted: plugin errors and versions that are easy to diagnose.
- Gap: `bb plugin list` shows the last RPC error until reload, with no message or time.
  `bb plugin rpc call X state` with no input gives 400 instead of sending `{}`.
  `bb plugin logs caffeine` was empty. `bb plugin types --check` compares the literal
  `catalog:` with the SDK version. The `bb` CLI on PATH lagged the app version.
- Workaround: none.
- Ask: fix each item.
- Status: open
- Category: cli
- Evidence: @thread:thr_w2ahaf7phe, commit `ef48adfe`

### Plugin scaffold and build traps

- Found: 2026-10-12, model-favourites, BB 0.46.0
- Wanted: a frontend-only plugin that builds with the repo's package manager.
- Gap: `bb plugin new` runs `npm install` with no pnpm option. The builder requires a
  server entry and branding for a frontend-only plugin. The Tailwind scanner honours a
  `*` `.gitignore`, so no classes are emitted. An invalid icon name shows a lightning
  bolt without a warning.
- Workaround: stub server entries and manual testing.
- Ask: a package-manager option, an optional server entry, and an icon-name type.
- Status: open
- Category: cli
- Evidence: `spikes/model-favourites`

### GitHub releases have no changelog

- Found: 2026-10-10, no plugin
- Wanted: release notes that say what changed.
- Gap: `.github/workflows/build-desktop.yml:442-446` hardcodes
  `--notes "bb desktop ${VERSION}"`. Upstream #1390 was closed, but the notes are still a
  placeholder.
- Workaround: a `scripts/release-notes.mjs` spike on a local branch.
- Ask: merge the release-notes script.
- Status: requested <https://github.com/get-bb/bb/issues/5348>
- Category: other
- Evidence: @thread:thr_hg9ykryvqq

### Composer submission data has no native-send hook

- Wanted: attach a draft's Executor choice to every submission before dispatch.
- Gap: `useComposer().submit({ experimental_data })` carries plugin data, but
  composer customisations cannot attach it to native sends or another plugin's
  `submit` call.
- Workaround: Executor captures its new-thread form's submit event and editor
  Enter, then submits through the SDK. Its dispatch hook saves the choice before
  agent configuration. Other plugins' direct submissions bypass this bridge.
- Ask: provide draft-scoped plugin submission data that all send paths carry.
- Evidence: `executor/draft.tsx`, `executor/server.ts` and live request inspection.

### Composer selection omits session options

- Wanted: save and apply Daybreak favourites in both existing and new-thread composers.
- Gap: SDK 0.6.49 exposes model `sessionOptions`, `threads.update` and timeline
  option values, but `ComposerSelection` and `setSelection` omit session options.
  A plugin cannot read or update a new-thread draft's native Daybreak choice.
- Workaround: Agent Switcher updates existing threads through `threads.update`,
  then checks the timeline's pending or effective value. New-thread drafts use
  the native picker. Daybreak favourites explain this limit before selection.
- Ask: include session options in composer selection and its settled result.
- Evidence: `claude-profiles/ui/picker/controller.ts` and SDK 0.6.49 declarations.

## Unconfirmed signals

- BB does not restart a running Claude process when provider env changes. (@thread:thr_7m6n8hipb3)
- Execution status cannot show that a stopped thread waits on a text question. (@thread:thr_yc4rernm5g)
- No utility-window API for a detached hands-free panel. (@thread:thr_fmstsag45f, commit `9e5fb80b`)
- No client-dials-machine mode, and one desktop app cannot use two servers. (@thread:thr_9587k923g3)
- Native questions from a relayed remote agent attach to the proxy thread, not the parent. (@thread:thr_8e9bkqim8w)
- No theme-change event; `themes.get` must be polled. (`visual-replies` app.tsx:35)
- The frontend cannot write plugin settings. (`spikes/tmux/machine-vitals`)
- No `--chart-*` tokens; plugins read undocumented colour tokens. (@thread:thr_iang4iumus)
- `setSelection` silently ignores unsupported fields, and queued-message editors cannot write selections. (`spikes/model-favourites`)
- The 10 s dispatch hook limit plus a server-wide lock can fail a Send to a slow host. (@thread:thr_kf4v4zdv28)
- Executor tool approvals have no BB approval form; a `pendingInteraction` slot may cover it. (`executor/README.md:64`)
- BB encodes route segments. (commit `46084430`)
- Writing settings inside a `bb.http.route` handler may deadlock the worker. Second-hand. (@thread:thr_gphz9jr2wb)
- An archived thread was still listed. Unverified. (2026-10-12 Claude transcript)
- Builtin plugins ship source maps without sources. (2026-10-02 Claude transcript)
- The feature-request form cannot be filled through `gh`, and screenshots need repo write access. (@thread:thr_x523wkg7m3)
- Inline visualisations look plain next to T3 Code. (2026-10-12 Codex session)
