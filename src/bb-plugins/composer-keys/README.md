# Composer Keys

Terminal-style keys for BB's text fields.

| Field | Enter | Alt+Enter | Shift+Enter | Cmd+Enter |
| --- | --- | --- | --- | --- |
| Composer | Send (BB) | Newline | Newline (BB) | BB default |
| Question "Other" answer | Submit | Newline | Newline (BB) | Submit (BB) |

Escape in the composer clicks **Stop run** while an agent runs, then keeps
focus in the composer. With no run and an empty composer, Escape twice within
500 ms opens the rewind picker. BB's other Escape uses (mention menu, voice input) take precedence.

## Rewind picker

The composer + menu offers Rewind. Select a message to edit it. Buttons offer
Fork, Rewind, Back and Close without a keyboard.

```text
Esc Esc -> list of your messages -> Enter -> edit -> Enter -> thread rewinds
                                 -> f     -> fork from before it, opens it
```

| Key | List | Edit |
| --- | --- | --- |
| ↑↓ or j/k | Move | - |
| Home/End | First/last message | - |
| Enter | Edit the selected message | Rewind with the edited text |
| Alt/Shift+Enter | - | Newline |
| f | Fork from just before it | - |
| Esc | Close | Back to the list |
| Q | Close | Type Q |

Rewinding calls `threads.editMessage`. BB removes the selected turn and every
later turn, then runs the edited text. Workspace files stay as they are. The
anchor is the event sequence of the prompt's `client/turn/requested` event.
Unchanged text keeps its mentions. Edited text drops them, because their
offsets point into the old text.

BB hardcodes these handlers and has no setting for them. A capture-phase
`keydown` listener stops the original key and re-dispatches the key BB already
handles: Shift+Enter in the composer, Cmd+Enter in the question box.
BB's composer answers an unclaimed Escape by blurring itself, so the plugin
acts only when the composer lost focus to that Escape. The second Escape of a
pair lands on `<body>`, because the first one blurred the composer. Question
newlines use `insertText`, so undo still works.

The selectors depend on BB's markup: `[data-promptbox]` with a
`contenteditable` editor, the `Stop run` and `Edit message` button labels, and the
`Type your own answer…` placeholder. If a BB
update breaks a key, check those markers first.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` from this directory.
