# Fork

Fork a thread with its whole conversation, like the tmux `prefix Alt+b` branch.
Side chat takes only quoted text. A fork clones the provider session.

| Surface | Action | Result |
| --- | --- | --- |
| `Alt+B` | Fork the focused pane's thread | New thread at the tip, split right |
| Message bar **Fork from here** | Fork at that message | Split right |
| Thread menu **Fork** | Split right, Split down, Sidebar only, New worktree | As named |

An assistant message keeps its turn in the fork. A user message branches before
it, like editing that prompt. Rebind `Alt+B` in Settings → Keyboard
(`plugin:fork/split`).

A fork reuses the source environment, so both threads edit the same files. Pick
**New worktree** for parallel edits. BB requires a fork to stay on the source
machine, so the worktree is created there. The project must be a Git repository.

Commands and message actions get no SDK client. An app overlay lends them its
`useSdk()` client and shows "Forking…" and failures, which BB would only log.
One fork runs at a time, so a repeated key press does not fork twice.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` from this directory.
