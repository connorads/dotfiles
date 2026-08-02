# Inject pointers via `load-buffer` + `paste-buffer -p`, not `send-keys`

`skl` delivers a pointer into a running agent's tmux pane in three argv-form
`tmux` calls: the skill **name** as a visible literal (`send-keys -l "NAME "`),
then the **bulk** (path + tree + read-instruction) loaded into a *unique* buffer
via **stdin** (`load-buffer -b skl-<uniq> -`) and pasted with
`paste-buffer -p -d` (`-p` = bracketed paste, `-d` = delete the buffer after).
The target pane is `--target` if given, else the popup's origin `#{pane_id}`,
else the last-active pane (`display-message -p -t '{last}' '#{pane_id}'`). Enter
is **never** pressed unless `--submit`.

## Considered options

- **Multi-line `send-keys -l "<whole pointer>"`**: rejected. The payload is on
  the command line (argv), so newlines, backticks, `$`, `;`, quotes and the
  unicode tree glyphs all need escaping and risk shell/keys interpretation. It
  also would not trigger the agent CLI's paste-collapse, so a stacked list of
  skills would flood the input with raw tree text instead of tidy
  `[Pasted text +N lines]` blobs.
- **`load-buffer <file>` (temp file) instead of stdin**: rejected — needs a temp
  path, cleanup, and a second failure mode. `load-buffer -` reads the payload
  from **stdin**, so the bytes never touch argv or the filesystem.
- **A single shared buffer name**: rejected — stacking several injections (or two
  popups) races on one buffer. A unique `skl-<pid>-<n>` buffer per injection,
  deleted by `-d`, avoids it.
- **Always press Enter**: rejected — the whole point is to *stack* several skills
  into one message and submit yourself; auto-submit could fire mid-turn.

## Consequences

- **Verbatim, injection-safe delivery.** Every `tmux` call is argv-form
  `Bun.spawn` (never a shell string) and the bulk travels via stdin, so arbitrary
  bytes survive byte-for-byte with no shell-injection surface. The visible name
  stays readable between collapsed paste blocks when stacking.
- **`paste-buffer -p` is adaptive — the load-bearing surprise.** Proven with a
  DECSET-2004 spike: a target that *requests* bracketed paste (Claude Code,
  codex, opencode) gets the payload wrapped in `\e[200~ … \e[201~`, so it
  collapses to `[Pasted text +N lines]` **and newlines do not submit**; a raw
  reader (`cat`) gets clean plain text with no markers. So `-p` does the right
  thing for both classes.
- **Known failure mode:** a *line-editing REPL without* bracketed paste (e.g. the
  node REPL) treats each `\n` as Enter and submits line-by-line. Agent CLIs are
  not in this class (they enable BP), so this is acceptable — but it's why the
  integration test uses `cat` (raw) and the manual smoke test must confirm
  against the real agent TUI.
- **Couples `skl` to tmux.** Fine — `skl` is a tmux tool by definition; the popup
  keybind passes the origin `#{pane_id}` so the agent pane is targeted exactly.
