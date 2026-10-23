# Fork

Fork a thread with its whole conversation, like the tmux `prefix Alt+b` branch.
Side chat takes only quoted text. A fork clones the provider session.

| Surface | Action | Result |
| --- | --- | --- |
| `Alt+B` | Open the fork menu for the focused thread | Pick a key below |
| `Alt+Shift+B` | Fork like last time | Last placement, worktree and count; Switch to fork at first |
| Message bar **Fork from here** | Open the fork menu at that message | Pick a key below |
| Side panel **+** → **Fork** | Fork this thread into a new panel tab | Like side chat |
| Thread menu **Fork** | Switch to fork, Split right, Split down, Side panel, New worktree | As named |

```text
⏎      Switch to fork: the focused pane shows the fork; the original stays in the sidebar
s      Side panel: stay here; the fork opens in this thread's side panel
| →    Split right        ←  Split left
- ↓    Split down         ↑  Split up
2–8    Fork count         w  New worktree (toggle)
m      Model and effort   p  First prompt
c      Copy fork command  y  Copy thread id
```

Count, worktree, model and prompt are options. Set them first, then press a
placement key. With a count, Switch to fork shows the first fork and leaves the
rest in the sidebar. Escape leaves a step, then closes the menu. Tab moves
between rows.

Side panel opens each fork as a tab in the focused thread's side panel, like
side chat. Unlike a side chat, the fork is a full thread and stays in the sidebar.
Where BB has no side panel, a notice says the fork is in the sidebar.

A model choice is set on the fork before its first prompt, so the first turn
uses it. `Alt+Shift+B` does not repeat a model or prompt. Rebind both keys in
Settings → Keyboard (`plugin:fork/menu`, `plugin:fork/repeat`).

An assistant message keeps its turn in the fork. A user message branches before
it, like editing that prompt.

A fork reuses the source environment, so both threads edit the same files. Pick
**New worktree** for parallel edits. BB requires a fork to stay on the source
machine, so the worktree is created there. The project must be a Git repository.

Commands and message actions get no SDK client. An app overlay lends them its
`useSdk()` client, hosts the menu, and shows progress and failures, which BB
would only log. The menu uses the shared [Chip](../chip/README.md) popover.
One fork runs at a time, so a repeated key press does not fork twice.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` from this directory.

## Split chat keyboard scrolling

Click conversation text or Tab into a numbered **Conversation** region. PageUp,
PageDown and arrow keys then scroll that chat. A keyboard focus outline marks
its viewport. Composer keys retain their editing behaviour.

Fork opens stock BB thread views. A content script adds a named tab stop to
stock split chat viewports under `[data-split-pane-id][data-focused]` and
`[data-thread-window]`. It preserves native accessibility attributes and removes
its additions on disposal or when a viewport leaves the split. This shared
surface includes ordinary split threads as well as forks. Side panel forks
render in a plugin `ThreadChat`, which this workaround leaves unchanged.

The selectors depend on observed BB markup. Unknown layouts receive no decoration.
The scrollbar stays visible while the conversation is hovered or contains focus.
Outside those states, stock BB controls its fade.
