# Run in Terminal

Paste shell commands from a chat message into the thread's terminal. Nothing
runs until you press Enter, so you can edit a command or stop before a
destructive one.

- **Selection menu.** Highlight commands in an assistant message, then choose
  **Run in terminal**. Only the highlighted text is pasted.
- **Message action bar.** The terminal icon pastes every `bash`, `sh`, `zsh`,
  `shell` or `console` fence in the message, in order.

```text
selection or shell fences → strip `$ ` prompts → "Commands" terminal (thread checkout) → bracketed paste → side panel
```

The plugin reuses one running terminal titled `Commands` per thread, so `cd`
and exported variables carry over between pastes. A new terminal gets the text
after its shell draws the first prompt. The paste is bracketed, so the shell
shows multi-line text as one editable buffer instead of running each line.

A notice in the bottom-right corner reads "Pasting into the Commands terminal…"
while a slow paste is in flight. Further clicks in that thread are ignored until
it finishes, so the buffer never holds the same commands twice. A failed paste
shows an error there instead; it closes with its close button or after 6 s.

BB has no plugin slot on code fences, so the button cannot sit beside a
fence's copy button.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` from this directory.
